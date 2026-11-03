# Command one PCA9685 servo channel.
uint8 ch          # channel 0..15
float32 deg       # target angle in degrees (0..180);
                  # values > 500 are treated as pulse width in microseconds
