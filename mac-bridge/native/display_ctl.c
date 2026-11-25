#include <CoreGraphics/CoreGraphics.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

extern int DisplayServicesGetBrightness(CGDirectDisplayID display, float *brightness);
extern int DisplayServicesSetBrightness(CGDirectDisplayID display, float brightness);

int main(int argc, char **argv) {
    CGDirectDisplayID displays[8];
    uint32_t count = 0;
    if (CGGetActiveDisplayList(8, displays, &count) != kCGErrorSuccess || count == 0) {
        displays[0] = CGMainDisplayID();
        count = 1;
    }

    if (argc >= 2) {
        double pct = atof(argv[1]);
        if (pct < 0.0) pct = 0.0;
        if (pct > 100.0) pct = 100.0;
        float target = (float)(pct / 100.0);
        for (uint32_t i = 0; i < count; i++) {
            DisplayServicesSetBrightness(displays[i], target);
        }
        printf("%d\n", (int)round(pct));
        return 0;
    }

    float cur = -1.0f;
    for (uint32_t i = 0; i < count; i++) {
        if (DisplayServicesGetBrightness(displays[i], &cur) == 0 && cur >= 0.0f && cur <= 1.0f) {
            printf("%d\n", (int)round(cur * 100.0f));
            return 0;
        }
    }
    printf("-1\n");
    return 0;
}
