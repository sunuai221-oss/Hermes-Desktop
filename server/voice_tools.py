import asyncio
import json
import sys
from pathlib import Path


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


async def synthesize_edge(payload: dict) -> None:
    try:
        import edge_tts
    except Exception as exc:  # pragma: no cover - runtime dependency
        emit_error(f"edge_tts unavailable: {exc}")
        return

    text = str(payload.get("text") or "").strip()
    output_path = payload.get("output_path")
    if not text:
        emit_error("text is required")
        return
    if not output_path:
        emit_error("output_path is required")
        return

    voice = payload.get("voice") or "en-US-AriaNeural"
    rate = payload.get("rate") or "+0%"

    try:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
        await communicate.save(output_path)
        emit({"ok": True, "output_path": output_path, "voice": voice})
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
    if action == "synthesize":
        asyncio.run(synthesize_edge(payload))
        return

    emit_error(f"unsupported action: {action}")


if __name__ == "__main__":
    main()
