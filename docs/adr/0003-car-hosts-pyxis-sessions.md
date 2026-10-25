# The car is a Pyxis device that hosts its own session

The car app claims a Pyxis device and hosts the playback session itself, reporting state over `/realtime` and logging listens. We chose this over plain track streaming so that listens are recorded and a queue can be handed off between the house and the car. Ossicle has no session model; the car plays its audio directly and writes revisioned positions.
