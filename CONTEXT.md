# Vela

One driving screen for a Galaxy Z Fold 8 in a car mount: turn-by-turn navigation and listening, from the driver's own services, in one calm view.

## Listening

**Source**:
One of the three kinds of listening the driver chooses between: Music, Podcasts, Books.
_Avoid_: App, service, tab, band

**Service**:
A program the driver already runs that supplies a Source: Pyxis supplies Music; Ossicle supplies Podcasts and Books.
_Avoid_: Source, backend, provider

**Music**:
Albums and tracks from Pyxis.

**Podcasts**:
Episodes from Ossicle subscriptions, including YouTube channels, always played as audio.
_Avoid_: Shows, videos

**Books**:
EPUBs from the driver's reader library, read aloud by Ossicle's text-to-speech narration.
_Avoid_: Audiobooks (implies studio-narrated files, which this product does not play)

**Shelf**:
The last item heard from each Source, shown together so one tap resumes any of them.
_Avoid_: Recents, history, favourites

**Now playing**:
The one item currently loaded for listening; only one Source plays at a time.

**Turn sound**:
The short sound that announces a Stop. In Sounds only it plays over media without pausing or ducking it. When a Co-driver speaks the directions, Music gets quieter; Podcasts and Books pause and resume two seconds back.
_Avoid_: Chime, alert, voice prompt

**Sound mode**:
How Vela announces Stops: Sounds only (the default), or a Co-driver. It does not affect talking: the chosen Co-driver listens and answers in either mode. In Sounds only, a Moment the driver did not ask for appears without speaking.

**Co-driver**:
The driver's personal assistant in one of its car personalities, each with its own synthesized voice. It reads directions and route moments aloud, comments now and then, and talks with the driver when asked. It shares the assistant's memory.
_Avoid_: Voice assistant, voice, narrator, a separate character

**Personal assistant**:
The driver's always-on assistant on the home fleet. Vela is one of its surfaces, not a separate brain.
_Avoid_: Brain, backend, bot

**Talk**:
The driver presses the talk target, or says "Hey Vela", and speaks. The wake word runs on the phone and keeps the microphone open for it alone (ADR 0009); nothing leaves the phone until it is heard. Pressing talk stops a Co-driver mid-sentence. Talk pauses what is playing until the answer finishes, the driver cancels, or no answer comes. Music resumes in place; Podcasts and Books resume two seconds back. Media the driver paused stays paused.
_Avoid_: Listening mode

## Navigation

**Destination**:
The place the current route ends.
_Avoid_: Terminus, target

**Stop**:
A point on the route where the driver must act (a turn, a merge, a keep-left), plus the Destination as the last Stop.
_Avoid_: Station, waypoint, manoeuvre

**Next stop**:
The Stop the driver reaches next; its instruction is the largest thing on screen.

**Saved place**:
A Destination the driver has named for reuse, such as Home or Work.

**Recent destination**:
A Destination used before, offered again without typing.

**Route**:
The planned path to a Destination, with its Stops.
_Avoid_: Trip, directions

**Trip**:
One recorded drive, from setting off to stopping, whether or not it had a Route. The personal assistant recalls past Trips.
_Avoid_: Drive, journey, ride

**Range**:
How far the car can still go on the fuel in its tank, estimated by Vela from the fuel level and recent consumption.
_Avoid_: Distance to empty, DTE, fuel left

## Look

**Light**:
The screen's colour field, taken from the cover of what is playing.
_Avoid_: Background, theme, wallpaper

**Source tint**:
The fixed dark colour that stands in for the Light when a cover is missing or too bright to sit behind text.
_Avoid_: Fallback colour, default theme

**Daylight contrast**:
The stronger-contrast form of the same look, on between sunrise and sunset at the car's position.
_Avoid_: Day mode, light theme

**Moment**:
A screen the Co-driver composes for one situation, in the Look's own parts, with one line it speaks. It waits while the next Stop is close, and gives way to the usual screen when its situation has passed.
_Avoid_: Card, popup, scene, widget
