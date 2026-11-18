#!/usr/bin/env python
"""Downloads a public speaker dataset (LibriSpeech, openslr.org, CC BY 4.0) and turns it into the layout the
report script uses: data/public_samples/<speaker_id>/<n>.wav  (16 kHz mono, ~4 s clips like the app records).

    ml\\.venv\\Scripts\\python.exe ml\\eval\\prepare_public_dataset.py                 # small set: dev-clean-2 (~126 MB, 40 speakers)
    ml\\.venv\\Scripts\\python.exe ml\\eval\\prepare_public_dataset.py --set test-clean # bigger (~350 MB, 40 speakers, checksum verified)
    ml\\.venv\\Scripts\\python.exe ml\\eval\\prepare_public_dataset.py --set train-clean-100 --archive C:\\path\\train-clean-100.tar.gz --speakers 60
        (6.3 GB, 251 speakers: the archive is READ AS A STREAM, never fully extracted; every Nth speaker is taken)
    ... --archive C:\\path\\dev-clean-2.tar.gz                                          # use an archive you already downloaded
LibriSpeech is clean read speech, so scores are EASIER than your browser microphone. Use it as a sanity check and
for relative comparisons; do not use it as the only basis for the final threshold.
"""
import argparse, hashlib, io, shutil, sys, tarfile, urllib.request
from math import gcd
from pathlib import Path, PurePosixPath

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

SETS = {
    "dev-clean-2": ("http://www.openslr.org/resources/31/dev-clean-2.tar.gz", None),
    "dev-clean": ("http://www.openslr.org/resources/12/dev-clean.tar.gz", None),
    "test-clean": ("http://www.openslr.org/resources/12/test-clean.tar.gz",
                   "39fde525e59672dc6d1551919b1478f724438a95aa55f874b576be21967e6c23"),
    "train-clean-100": ("http://www.openslr.org/resources/12/train-clean-100.tar.gz", None),
}
SR, CLIP_SEC = 16000, 4.0


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def best_window(x):
    """The CLIP_SEC window with the most energy (so the clip contains speech, not a pause)."""
    n, step = int(CLIP_SEC * SR), SR // 2
    if len(x) < int(3.0 * SR):
        return None
    if len(x) <= n:
        return x
    starts = range(0, len(x) - n + 1, step)
    return max((x[s:s + n] for s in starts), key=lambda w: float(np.mean(w ** 2)))


def flacs(archive):
    """Yield (speaker, chapter, read_bytes) for each .flac, reading the .tar.gz as a stream (no extraction)."""
    with tarfile.open(archive, "r|gz") as t:
        for m in t:
            if m.isfile() and m.name.endswith(".flac"):
                parts = PurePosixPath(m.name).parts
                yield parts[-3], parts[-2], (lambda m=m: t.extractfile(m).read())


def flacs_dir(root):
    """Same as flacs() but for a folder you already extracted: <root>/**/<speaker>/<chapter>/<file>.flac"""
    for f in sorted(Path(root).rglob("*.flac")):
        yield f.parts[-3], f.parts[-2], (lambda f=f: f.read_bytes())


def to_clip(raw):
    x, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    if sr != SR:
        g = gcd(sr, SR); x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    return best_window(x)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", default="dev-clean-2", choices=SETS)
    ap.add_argument("--archive", help="use this local .tar.gz instead of downloading")
    ap.add_argument("--folder", help="use an already EXTRACTED LibriSpeech folder (e.g. C:\\Users\\you\\Downloads\\train-clean-100\\LibriSpeech)")
    ap.add_argument("--out", default="data/public_samples")
    ap.add_argument("--speakers", type=int, default=40)
    ap.add_argument("--speaker-step", type=int, default=0, help="take every Nth speaker (default: 1, or 4 for train-clean-100)")
    ap.add_argument("--per", type=int, default=6, help="clips per speaker (3 enroll + rest test)")
    ap.add_argument("--keep", action="store_true", help="keep a downloaded archive")
    a = ap.parse_args()
    step = a.speaker_step or (4 if a.set == "train-clean-100" else 1)

    work = Path("data/_downloads"); work.mkdir(parents=True, exist_ok=True)
    url, expected = SETS[a.set]
    archive = Path(a.archive) if a.archive else work / Path(url).name
    if a.folder:
        if not Path(a.folder).is_dir():
            sys.exit(f"Folder not found: {a.folder}")
    elif not archive.exists():
        if a.set == "train-clean-100":
            print("WARNING: train-clean-100 is ~6.3 GB. A browser download (resumable) + --archive is safer than this script.")
        print(f"Downloading {url}\n(this can take several minutes)")
        def hook(b, bs, total):
            if total > 0 and b % 200 == 0:
                print(f"\r  {min(100, b * bs * 100 // total)}%", end="", flush=True)
        urllib.request.urlretrieve(url, archive, hook); print()
    if expected and not a.folder:
        digest = sha256(archive)
        if digest != expected:
            sys.exit(f"Checksum mismatch for {archive.name}: got {digest}. Delete the file and download it again.")
        print(f"Checksum verified ({archive.name})")

    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    kept = seen = 0
    cur, take, clips, spill, chap = None, False, [], [], {}

    def flush():
        nonlocal kept
        pool = clips + spill                      # diverse clips first (<= 2 per chapter), then fill up from the rest
        if cur is not None and take and len(pool) >= a.per:
            (out / cur).mkdir(parents=True, exist_ok=True)
            for i, w in enumerate(pool[: a.per], 1):
                sf.write(out / cur / f"{i}.wav", w, SR, subtype="PCM_16")
            kept += 1
            print(f"  speaker {cur}: {a.per} clips ({kept}/{a.speakers})", flush=True)

    src = Path(a.folder).name if a.folder else archive.name
    print(f"Reading {src} (every {step}. speaker, up to {a.speakers} speakers)...")
    try:
        for spk, ch, get in (flacs_dir(a.folder) if a.folder else flacs(archive)):
            if spk != cur:
                flush()
                if kept >= a.speakers:
                    cur = None; break
                take = seen % step == 0; seen += 1
                cur, clips, spill, chap = spk, [], [], {}
            if not take or len(clips) >= a.per:
                continue
            over = chap.get(ch, 0) >= 2                                      # prefer <= 2 clips per chapter (different sessions)
            if over and len(spill) >= a.per:
                continue
            w = to_clip(get())
            if w is None:
                continue
            if over:
                spill.append(w)
            else:
                clips.append(w); chap[ch] = chap.get(ch, 0) + 1
        else:
            flush()
    except (tarfile.ReadError, EOFError) as e:
        sys.exit(f"The archive looks incomplete or corrupt ({e}). Download it again.")
    out.mkdir(parents=True, exist_ok=True)
    (out / "SOURCE.txt").write_text(f"LibriSpeech {a.set} (Panayotov et al., 2015) - http://www.openslr.org/12 - CC BY 4.0\n{kept} speakers x {a.per} clips of {CLIP_SEC}s (every {step}. speaker)\n")
    if not a.keep and not a.archive and not a.folder:
        archive.unlink(missing_ok=True)
    print(f"Done: {kept} speakers x {a.per} clips in {out}")
    if kept < 2:
        sys.exit("Too few usable speakers.")


if __name__ == "__main__":
    main()
