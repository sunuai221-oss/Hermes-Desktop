import json
import sys


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=True))
    sys.stdout.flush()


def emit_error(message: str) -> None:
    emit({"ok": False, "error": message})


def transcribe_audio(payload: dict) -> None:
    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover - runtime dependency
        emit_error(f"faster_whisper unavailable: {exc}")
        return

    input_path = payload.get("input_path")
    if not input_path:
        emit_error("input_path is required")
        return

    model_name = payload.get("model") or "base"
    language = payload.get("language") or None

    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            input_path,
            language=language,
            vad_filter=True,
            beam_size=5,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text).strip()
        emit(
            {
                "ok": True,
                "text": text,
                "language": getattr(info, "language", None),
                "duration": getattr(info, "duration", None),
            }
        )
    except Exception as exc:  # pragma: no cover - runtime dependency
        emit_error(str(exc))


def main() -> None:
    try:
        if len(sys.argv) > 1:
            with open(sys.argv[1], "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        else:
            payload = json.load(sys.stdin)
    except Exception as exc:
        emit_error(f"invalid json payload: {exc}")
        return

    action = payload.get("action")
    if action == "transcribe":
        transcribe_audio(payload)
        return

    emit_error(f"unsupported action: {action}")


if __name__ == "__main__":
    main()
