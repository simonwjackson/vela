# A co-driver is the personal assistant, reached through voice-gateway

Co-drivers are not a second brain inside Vela. Vela connects to the personal assistant (its own repository) as a surface. The assistant gains car personalities as a persona overlay, plus car tools (playback, route changes, trip questions) that it runs on the connected Vela. Speech goes through the existing voice-gateway: Vela is a Realtime client with push to talk, whisper transcribes, and ElevenLabs voices are added to the gateway for the co-drivers. We chose this over letting Vela call the LLM itself, so there is one memory, one identity and one place where personas live.

## Considered options

- Vela orchestrates: it calls CLIProxyAPI with persona and tools, and uses the assistant only for memory over RPC. This was rejected because it makes two brains share one memory.

## Consequences

- The personal assistant runs on the home server. voice-gateway runs on the workstation, and its default brain address (`127.0.0.1:4318` on the workstation) points at a stopped service, so the gateway must be pointed at the assistant on the home server.
- assistant/core and voice-gateway both change. Vela's origin must join `ASSISTANT_WEB_ORIGINS` and the gateway's allowed origins.
- The live link breaks in dead zones. Directions then continue from co-driver lines cached at route start (ADR 0002), and Talk answers "no signal".
- ElevenLabs keys stay on the fleet, never on the phone.
