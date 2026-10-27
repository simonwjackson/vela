# Every screen moves into the Moment language, in steps

Vela's screens will all be written in the same vocabulary the Co-driver composes Moments in (ADR 0010), drawn by one renderer. Keeping today's hand-built screens beside a second renderer for Moments was rejected: the two would drift apart, and the approved screens would not serve as the model's examples. Rewriting all 68 states at once was rejected as too large a first step.

The move is staged: first the renderer and the usual drive screen as one part, so Moments can ship; then each area's states as programs, checked to draw the same as before.

## Consequences

- Until the move is finished, two ways of drawing a screen coexist.
- The built-in programs are the offline fallback: with no link to the assistant, Vela draws them without a model.
