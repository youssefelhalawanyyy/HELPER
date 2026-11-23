#include <ApplicationServices/ApplicationServices.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include <unistd.h>

static double now_ms(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return tv.tv_sec * 1000.0 + tv.tv_usec / 1000.0;
}

static void get_virtual_bounds(double *minX, double *minY, double *maxX, double *maxY) {
    CGDirectDisplayID displays[8];
    uint32_t count = 0;
    if (CGGetActiveDisplayList(8, displays, &count) != kCGErrorSuccess || count == 0) {
        *minX = 0; *minY = 0; *maxX = 1920; *maxY = 1080;
        return;
    }
    CGRect total = CGRectNull;
    for (uint32_t i = 0; i < count; i++) {
        total = CGRectUnion(total, CGDisplayBounds(displays[i]));
    }
    *minX = CGRectGetMinX(total);
    *minY = CGRectGetMinY(total);
    *maxX = CGRectGetMaxX(total) - 1.0;
    *maxY = CGRectGetMaxY(total) - 1.0;
}

static double clamp_d(double v, double lo, double hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

int main(void) {
    char line[128];
    double minX = 0, minY = 0, maxX = 1920, maxY = 1080;
    get_virtual_bounds(&minX, &minY, &maxX, &maxY);

    double curX = 0, curY = 0;
    double lastMoveTs = 0;
    int dragging = 0;

    while (fgets(line, sizeof(line), stdin) != NULL) {
        char cmd = line[0];

        if (cmd == 'M' || cmd == 'G') {
            double dx = 0, dy = 0;
            if (sscanf(line + 1, "%lf %lf", &dx, &dy) == 2) {
                double t = now_ms();
                // Sync with physical MacBook trackpad if idle > 120ms
                if (t - lastMoveTs > 120.0) {
                    CGEventRef cur = CGEventCreate(NULL);
                    CGPoint pos = CGEventGetLocation(cur);
                    CFRelease(cur);
                    curX = pos.x;
                    curY = pos.y;
                }
                lastMoveTs = t;

                // Micro-interpolation removes network jitter while staying ultra-fast (<4ms total)
                double dist = hypot(dx, dy);
                int steps = (dist > 18.0) ? 3 : (dist > 6.0 ? 2 : 1);
                double stepX = dx / steps;
                double stepY = dy / steps;
                CGEventType evType = (cmd == 'G' || dragging) ? kCGEventLeftMouseDragged : kCGEventMouseMoved;

                for (int i = 0; i < steps; i++) {
                    curX = clamp_d(curX + stepX, minX, maxX);
                    curY = clamp_d(curY + stepY, minY, maxY);
                    CGEventRef ev = CGEventCreateMouseEvent(
                        NULL, evType, CGPointMake(curX, curY), kCGMouseButtonLeft
                    );
                    if (ev) {
                        CGEventPost(kCGHIDEventTap, ev);
                        CFRelease(ev);
                    }
                    if (i < steps - 1) usleep(1500);
                }
            }
        } else if (cmd == 'C') {
            char btn = 'L';
            sscanf(line + 1, " %c", &btn);
            CGEventRef cur = CGEventCreate(NULL);
            CGPoint pos = CGEventGetLocation(cur);
            CFRelease(cur);
            curX = pos.x;
            curY = pos.y;

            CGEventType downT = (btn == 'R') ? kCGEventRightMouseDown : kCGEventLeftMouseDown;
            CGEventType upT = (btn == 'R') ? kCGEventRightMouseUp : kCGEventLeftMouseUp;
            CGMouseButton mb = (btn == 'R') ? kCGMouseButtonRight : kCGMouseButtonLeft;

            CGEventRef down = CGEventCreateMouseEvent(NULL, downT, pos, mb);
            CGEventRef up = CGEventCreateMouseEvent(NULL, upT, pos, mb);
            if (down) { CGEventPost(kCGHIDEventTap, down); CFRelease(down); }
            if (up) { CGEventPost(kCGHIDEventTap, up); CFRelease(up); }
        } else if (cmd == 'D') {
            CGEventRef cur = CGEventCreate(NULL);
            CGPoint pos = CGEventGetLocation(cur);
            CFRelease(cur);
            curX = pos.x;
            curY = pos.y;
            dragging = 1;
            CGEventRef down = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, pos, kCGMouseButtonLeft);
            if (down) { CGEventPost(kCGHIDEventTap, down); CFRelease(down); }
        } else if (cmd == 'U') {
            CGEventRef cur = CGEventCreate(NULL);
            CGPoint pos = CGEventGetLocation(cur);
            CFRelease(cur);
            dragging = 0;
            CGEventRef up = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, pos, kCGMouseButtonLeft);
            if (up) { CGEventPost(kCGHIDEventTap, up); CFRelease(up); }
        } else if (cmd == 'S') {
            int dx = 0, dy = 0;
            if (sscanf(line + 1, "%d %d", &dx, &dy) == 2 && (dx != 0 || dy != 0)) {
                CGEventRef scroll = CGEventCreateScrollWheelEvent(
                    NULL, kCGScrollEventUnitPixel, 2, dy, dx
                );
                if (scroll) {
                    CGEventPost(kCGHIDEventTap, scroll);
                    CFRelease(scroll);
                }
            }
        }
    }
    return 0;
}
