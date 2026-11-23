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
                if (t - lastMoveTs > 120.0) {
                    CGEventRef cur = CGEventCreate(NULL);
                    CGPoint pos = CGEventGetLocation(cur);
                    CFRelease(cur);
                    curX = pos.x;
                    curY = pos.y;
                }
                lastMoveTs = t;

                // Smooth sub-frame interpolation for silky 120Hz glide on fast swipes
                double dist = hypot(dx, dy);
                int steps = (dist > 36.0) ? 4 : (dist > 14.0 ? 3 : (dist > 5.0 ? 2 : 1));
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
                    if (i < steps - 1) usleep(1000);
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
        } else if (cmd == 'K') {
            // Instant <0.1ms native CoreGraphics key press: K <keyCode> <modMask>
            // modMask: 1=Cmd, 2=Shift, 4=Alt/Option, 8=Ctrl
            int keyCode = -1, modMask = 0;
            if (sscanf(line + 1, "%d %d", &keyCode, &modMask) >= 1 && keyCode >= 0) {
                CGEventFlags flags = 0;
                if (modMask & 1) flags |= kCGEventFlagMaskCommand;
                if (modMask & 2) flags |= kCGEventFlagMaskShift;
                if (modMask & 4) flags |= kCGEventFlagMaskAlternate;
                if (modMask & 8) flags |= kCGEventFlagMaskControl;

                CGEventRef kd = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keyCode, true);
                CGEventRef ku = CGEventCreateKeyboardEvent(NULL, (CGKeyCode)keyCode, false);
                if (kd) {
                    if (flags) CGEventSetFlags(kd, flags);
                    CGEventPost(kCGHIDEventTap, kd);
                    CFRelease(kd);
                }
                usleep(4000);
                if (ku) {
                    if (flags) CGEventSetFlags(ku, flags);
                    CGEventPost(kCGHIDEventTap, ku);
                    CFRelease(ku);
                }
            }
        }
    }
    return 0;
}
