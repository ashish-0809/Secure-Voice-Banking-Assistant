
"""Build reproducible, leakage-free speaker enrollment and trial lists."""

from pathlib import Path
import random


def list_speaker_files(root):
    """Return {speaker_id: [audio_paths]} from a LibriSpeech-style directory."""
    root = Path(root)
    speakers = {}

    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {
            ".flac", ".wav", ".mp3", ".ogg"
        }:
            continue

        try:
            relative = path.relative_to(root)
        except ValueError:
            continue

        if len(relative.parts) < 2:
            continue

        speaker = relative.parts[0]
        speakers.setdefault(speaker, []).append(str(path))

    return {
        speaker: sorted(paths)
        for speaker, paths in sorted(speakers.items())
    }


def build_trials(speaker_files, enroll_per_speaker=3,
                 genuine_per_speaker=5, impostor_per_speaker=8,
                 seed=7):
    """Return enrollment and trials with no enrollment/test clip overlap."""

    rng = random.Random(seed)

    speakers = sorted(speaker_files)
    if len(speakers) < 2:
        raise ValueError("At least two speakers are required.")

    enroll = []
    remaining = {}

    for speaker in speakers:
        files = sorted(set(speaker_files[speaker]))

        if len(files) <= enroll_per_speaker:
            raise ValueError(
                f"Speaker {speaker} needs more than "
                f"{enroll_per_speaker} audio files."
            )

        # Group files by chapter/session (parent directory).
        chapters = {}
        for path in files:
            chapter = Path(path).parent.name
            chapters.setdefault(chapter, []).append(path)

        chapter_names = sorted(chapters)
        if len(chapter_names) < 2:
            raise ValueError(
                f"Speaker {speaker} needs at least two chapters."
            )

        # Select enrollment clips across multiple chapters.
        selected = []
        for chapter in chapter_names:
            if len(selected) >= enroll_per_speaker:
                break
            selected.append(rng.choice(chapters[chapter]))

        candidates = [
            path for path in files if path not in selected
        ]

        if len(selected) < enroll_per_speaker:
            extra = [p for p in files if p not in selected]
            selected.extend(
                rng.sample(extra, enroll_per_speaker - len(selected))
            )

        for path in selected:
            enroll.append((speaker, path))

        remaining[speaker] = candidates

    trials = []

    for speaker in speakers:
        genuine_pool = list(remaining[speaker])
        if len(genuine_pool) < genuine_per_speaker:
            raise ValueError(
                f"Not enough genuine test clips for speaker {speaker}."
            )

        for path in rng.sample(genuine_pool, genuine_per_speaker):
            trials.append((speaker, speaker, 1, path))

        impostor_speakers = [s for s in speakers if s != speaker]
        impostor_pool = [
            (other, path)
            for other in impostor_speakers
            for path in remaining[other]
        ]

        if len(impostor_pool) < impostor_per_speaker:
            raise ValueError(
                f"Not enough impostor test clips for speaker {speaker}."
            )

        for other, path in rng.sample(
            impostor_pool, impostor_per_speaker
        ):
            trials.append((speaker, other, 0, path))

    rng.shuffle(trials)
    return enroll, trials
