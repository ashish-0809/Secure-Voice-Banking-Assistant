# Speaker embedding service

Run from the repository root after installing the Python dependencies:

```powershell
python -m pip install -r speaker_service/requirements.txt
python speaker_service/app.py
```

The service listens on `127.0.0.1:5005` and exposes:

- `GET /health` — lightweight health check; does not download/load the model.
- `POST /embed` — raw audio-file bytes in the request body; returns an ECAPA embedding and basic audio-quality metadata.
- `POST /transcribe` — optional challenge-phrase transcription; requires `faster-whisper` separately.

## Audio handling

`POST /embed` calls `ml.common.audio.preprocess`, the same preprocessing pipeline used by offline speaker evaluation. It converts audio to mono 16 kHz, trims leading/trailing silence, rejects unusable clips, and reports clipping warnings. The model is loaded lazily on the first valid `/embed` request. Preprocessing errors return HTTP 400; model/service errors return HTTP 503. A service failure must be treated as unavailable, never as a successful verification.

Install `soundfile>=0.12` for FLAC support (it uses libsndfile). WAV is the fallback format when `soundfile` is absent; FLAC is not supported by that fallback. This service accepts raw file bytes, not JSON/base64.

## Tests

From the repository root:

```powershell
python -m unittest ml.tests.test_speaker_service_app -v
python -m unittest discover -s ml/tests -t . -v
```

Service tests mock the speaker model, so they do not prove that pretrained ECAPA inference works. To verify the real model, install dependencies, start the service, and send a valid audio file to `/embed`.
