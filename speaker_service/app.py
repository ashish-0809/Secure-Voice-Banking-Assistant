"""Local ECAPA-TDNN speaker-embedding service for the Voice Banking Assistant.

Run from the repository root with ml/.venv activated:
    python -m speaker_service.app

The service uses the same audio preprocessing and pretrained model implementation as
ml/service/speaker.py, so live embeddings match the evaluation pipeline.
"""
from __future__ import annotations

from flask import Flask, jsonify, request

from ml.common import audio


def create_app(verifier_factory=None):
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
    factory = verifier_factory
    state = {"verifier": None, "error": None}

    def get_verifier():
        if state["verifier"] is None:
            try:
                if factory is None:
                    from ml.service.speaker import SpeakerVerifier
                    state["verifier"] = SpeakerVerifier()
                else:
                    state["verifier"] = factory()
                state["error"] = None
            except Exception as exc:
                state["error"] = type(exc).__name__
                raise
        return state["verifier"]

    @app.post("/embed")
    def embed():
        raw = request.get_data(cache=False)
        if not raw:
            return jsonify({"error": "empty_audio"}), 400
        try:
            processed = audio.preprocess(raw, trim=True)
        except audio.AudioError as exc:
            # Log the precise local validation reason for debugging; do not expose raw audio.
            app.logger.warning("Audio rejected by preprocessing: %s", str(exc))
            return jsonify({"error": exc.code, "detail": str(exc)}), 400
        try:
            embedding = get_verifier().embed_waveform(processed["wave"])
            return jsonify({
                "embedding": embedding.tolist(),
                "sample_rate": processed["sr"],
                "duration_sec": round(processed["duration_sec"], 3),
                "warnings": processed["warnings"],
            })
        except Exception:
            app.logger.exception("ECAPA speaker embedding failed")
            return jsonify({"error": "speaker_model_unavailable"}), 503

    @app.get("/health")
    def health():
        loaded = state["verifier"] is not None
        # ok is True only once the model is really loaded; the HTTP 200 just means "service is up".
        return jsonify({"ok": loaded, "service": "up", "model_loaded": loaded, "last_error": state["error"]})

    @app.post("/warmup")
    def warmup():
        try:
            verifier = get_verifier()
            info = verifier.info() if hasattr(verifier, "info") else {}
            return jsonify({"ok": True, "model_loaded": True, "model": info.get("model_id", "ECAPA-TDNN"), "device": info.get("device")})
        except Exception:
            app.logger.exception("ECAPA model initialization failed")
            return jsonify({"ok": False, "error": "speaker_model_unavailable"}), 503

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify({"error": "audio_too_large"}), 413

    return app


app = create_app()

if __name__ == "__main__":
    # Local-only service; do not expose the speaker model endpoint to a network.
    app.run(host="127.0.0.1", port=5005, threaded=True)
