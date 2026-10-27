# The Co-driver composes Moments in the personal assistant

The Co-driver can reshape the screen for a situation: a Moment, written in the Look's own vocabulary of parts. The personal assistant composes it and sends it to Vela over SurfaceLink (ADR 0007); Vela checks it and draws it. Composing in Vela itself was rejected: the repository is public and holds no keys (ADR 0005), and the assistant already has the model lanes, the memory, the generative-UI language and the check that feeds problems back to the model.

The design system is the constraint, not a fixed layout: a Moment may arrange the parts freely, but the parts own every size, colour and spacing. The 2026-10-26 spike (branch `spike/openui-signal`) found that budgets, not regions, keep it calm: one lead, at most two supporting parts, at most 12 words outside the lead, the explanation spoken rather than shown, and every fact shown once.

## Consequences

- With no link to the assistant, there are no Moments; Vela shows its usual screens.
- A Moment costs a model turn (10-19 s in the spike), so anything that must be instant stays in Vela.
- A Moment may start because the driver asked through Talk, or because Vela reports an event and the Co-driver judges it worth a screen, a chip, or nothing.
