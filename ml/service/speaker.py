"""
Speaker verification with a PRE-TRAINED ECAPA-TDNN model (SpeechBrain, trained on VoxCeleb1+2).

How it works:
  1. A voice clip is converted into a 192-dimensional speaker embedding.
  2. Enrollment: embeddings from multiple clips are averaged into a voice profile.
  3. Verification: cosine similarity compares a new embedding with the profile.
  4. Accept if similarity >= threshold calibrated on a separate validation set.

This project uses the pretrained model for inference only; it does not train the model.
"""

import time
from pathlib import Path

import numpy as np

from ml.common import audio
from ml.common.paths import MODELS

MODEL_ID = "speechbrain/spkrec-ecapa-voxceleb"
EMBEDDING_DIM = 192


class SpeakerVerifier:
    def __init__(self, device=None, model_dir=None):
        import torch

        self.torch = torch
        self.device = device or (
            "cuda" if torch.cuda.is_available() else "cpu"
        )
        self.model_id = MODEL_ID
        self.model_dir = Path(
            model_dir or MODELS / "spkrec-ecapa-voxceleb"
        )
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.model = self._load_model()

    def _load_model(self):
        try:
            from speechbrain.inference.speaker import EncoderClassifier
        except ImportError:
            from speechbrain.pretrained import EncoderClassifier

        from speechbrain.utils.fetching import LocalStrategy

        kwargs = {
            "source": self.model_id,
            "savedir": str(self.model_dir),
            "run_opts": {"device": self.device},
            "local_strategy": LocalStrategy.COPY,
        }

        model = EncoderClassifier.from_hparams(**kwargs)
        model.eval()
        return model

    # ---- Embeddings ---------------------------------------------------------

    def embed_waveform(self, wave):
        """Convert 16 kHz mono audio into an L2-normalized speaker embedding."""
        with self.torch.no_grad():
            tensor = (
                self.torch.from_numpy(
                    np.ascontiguousarray(wave, dtype=np.float32)
                )
                .unsqueeze(0)
                .to(self.device)
            )

            embedding = (
                self.model.encode_batch(tensor)
                .squeeze()
                .detach()
                .cpu()
                .numpy()
                .astype(np.float64)
            )

        return embedding / (np.linalg.norm(embedding) + 1e-12)

    def embed_file(self, source, trim=True):
        """Preprocess an audio file and return its speaker embedding."""
        processed = audio.preprocess(source, trim=trim)
        return self.embed_waveform(processed["wave"])

    def embed_files(self, paths, cache_path=None, trim=True, log_every=250):
        """
        Embed multiple audio files.

        Results may be cached in an NPZ file.
        Returns:
            embeddings: dict mapping file paths to embeddings
            failed: dict mapping file paths to audio failure codes
        """
        paths = [str(path) for path in paths]
        unique_paths = list(dict.fromkeys(paths))

        cache = {}

        if cache_path and Path(cache_path).exists():
            with np.load(cache_path, allow_pickle=False) as saved:
                if (
                    str(saved["model_id"]) == self.model_id
                    and bool(saved["trim"]) == bool(trim)
                ):
                    cache = dict(
                        zip(saved["paths"].tolist(), saved["embs"])
                    )

        todo = [path for path in unique_paths if path not in cache]
        failed = {}
        start = time.time()

        def save_cache():
            if cache_path and cache:
                cache_file = Path(cache_path)
                cache_file.parent.mkdir(parents=True, exist_ok=True)

                np.savez(
                    cache_file,
                    paths=np.array(list(cache.keys())),
                    embs=np.stack(list(cache.values())),
                    model_id=np.array(self.model_id),
                    trim=np.array(bool(trim)),
                )

        for index, path in enumerate(todo, start=1):
            try:
                cache[path] = self.embed_file(path, trim=trim)
            except audio.AudioError as error:
                failed[path] = error.code

            if index % log_every == 0 or index == len(todo):
                print(
                    f"  embedded {index}/{len(todo)} files "
                    f"({time.time() - start:.0f}s)",
                    flush=True,
                )

            if index % 1000 == 0:
                save_cache()

        if todo:
            save_cache()

        embeddings = {
            path: cache[path]
            for path in unique_paths
            if path in cache
        }

        return embeddings, failed

    # ---- Profile and scoring -----------------------------------------------

    @staticmethod
    def make_profile(embeddings):
        """Average enrollment embeddings and normalize the resulting profile."""
        mean_embedding = np.mean(np.stack(embeddings), axis=0)
        return mean_embedding / (
            np.linalg.norm(mean_embedding) + 1e-12
        )

    @staticmethod
    def score(profile, embedding):
        """Return cosine similarity between normalized vectors."""
        return float(np.dot(profile, embedding))

    def info(self):
        """Return model and runtime details for reproducible evaluation."""
        import speechbrain

        details = {
            "model_id": self.model_id,
            "embedding_dim": EMBEDDING_DIM,
            "device": self.device,
            "torch": self.torch.__version__,
            "speechbrain": getattr(
                speechbrain, "__version__", "unknown"
            ),
            "sample_rate": audio.TARGET_SR,
        }

        if self.device == "cuda":
            details["gpu"] = self.torch.cuda.get_device_name(0)

        return details
