#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <string.h>

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

int main(void) {
    char line[128];
    double minX = 0, minY = 0, maxX = 1920, maxY = 1080;
    get_virtual_bounds(&minX, &minY, &maxX, &maxY);

    while (fgets(line, sizeof(line), stdin) != NULL) {
        if (line[0] == 'M') {
            double dx = 0, dy = 0;
            if (sscanf(line + 1, "%lf %lf", &dx, &dy) == 2) {
                CGEventRef cur = CGEventCreate(NULL);
                CGPoint pos = CGEventGetLocation(cur);
                CFRelease(cur);

                double nx = pos.x + dx;
                double ny = pos.y + dy;
                if (nx < minX) nx = minX;
                if (nx > maxX) nx = maxX;
                if (ny < minY) ny = minY;
                if (ny > maxY) ny = maxY;

                CGEventRef move = CGEventCreateMouseEvent(
                    NULL, kCGEventMouseMoved, CGPointMake(nx, ny), kCGMouseButtonLeft
                );
                if (move) {
                    CGEventPost(kCGHIDEventTap, move);
                    CFRelease(move);
                }
            }
        } else if (line[0] == 'C') {
            char btn = 'L';
            sscanf(line + 1, " %c", &btn);
            CGEventRef cur = CGEventCreate(NULL);
            CGPoint pos = CGEventGetLocation(cur);
            CFRelease(cur);

            CGEventType downT = (btn == 'R') ? kCGEventRightMouseDown : kCGEventLeftMouseDown;
            CGEventType upT = (btn == 'R') ? kCGEventRightMouseUp : kCGEventLeftMouseUp;
            CGMouseButton mb = (btn == 'R') ? kCGMouseButtonRight : kCGMouseButtonLeft;

            CGEventRef down = CGEventCreateMouseEvent(NULL, downT, pos, mb);
            CGEventRef up = CGEventCreateMouseEvent(NULL, upT, pos, mb);
            if (down) { CGEventPost(kCGHIDEventTap, down); CFRelease(down); }
            if (up) { CGEventPost(kCGHIDEventTap, up); CFRelease(up); }
        } else if (line[0] == 'S') {
            int dy = 0;
            if (sscanf(line + 1, "%d", &dy) == 1 && dy != 0) {
                CGEventRef scroll = CGEventCreateScrollWheelEvent(
                    NULL, kCGScrollEventUnitPixel, 1, dy
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
