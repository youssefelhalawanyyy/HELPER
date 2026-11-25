#import <CoreGraphics/CoreGraphics.h>
#import <CoreImage/CoreImage.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <stdint.h>
#import <stdio.h>
#import <stdlib.h>
#import <unistd.h>

static int write_all(int fd, const uint8_t *buf, size_t len) {
    size_t sent = 0;
    while (sent < len) {
        ssize_t n = write(fd, buf + sent, len - sent);
        if (n <= 0) return -1;
        sent += (size_t)n;
    }
    return 0;
}

@interface StreamDelegate : NSObject <SCStreamOutput, SCStreamDelegate>
@property (nonatomic, strong) CIContext *ciContext;
@property (nonatomic, assign) CGColorSpaceRef colorSpace;
@property (nonatomic, strong) NSDictionary *jpegOpts;
@property (nonatomic, assign) volatile BOOL stopped;
@end

@implementation StreamDelegate

- (instancetype)initWithQuality:(double)quality {
    self = [super init];
    if (self) {
        self.ciContext = [CIContext contextWithOptions:@{
            kCIContextUseSoftwareRenderer: @NO,
            kCIContextPriorityRequestLow: @NO
        }];
        self.colorSpace = CGColorSpaceCreateDeviceRGB();
        self.jpegOpts = @{
            (NSString *)kCGImageDestinationLossyCompressionQuality: @(quality)
        };
        self.stopped = NO;
    }
    return self;
}

- (void)dealloc {
    if (self.colorSpace) {
        CGColorSpaceRelease(self.colorSpace);
        self.colorSpace = NULL;
    }
}

- (void)stream:(SCStream *)stream
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
        ofType:(SCStreamOutputType)type {
    if (self.stopped || type != SCStreamOutputTypeScreen) return;
    if (!CMSampleBufferIsValid(sampleBuffer)) return;

    CVPixelBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!pixelBuffer) return;

    @autoreleasepool {
        CIImage *ciImg = [CIImage imageWithCVPixelBuffer:pixelBuffer];
        if (!ciImg) return;

        NSData *jpegData = [self.ciContext JPEGRepresentationOfImage:ciImg
                                                          colorSpace:self.colorSpace
                                                             options:self.jpegOpts];
        if (!jpegData || jpegData.length == 0 || jpegData.length > 10 * 1024 * 1024) return;

        uint32_t len = (uint32_t)jpegData.length;
        uint8_t hdr[4] = {
            (uint8_t)((len >> 24) & 0xFF),
            (uint8_t)((len >> 16) & 0xFF),
            (uint8_t)((len >> 8) & 0xFF),
            (uint8_t)(len & 0xFF)
        };
        if (write_all(STDOUT_FILENO, hdr, 4) != 0 ||
            write_all(STDOUT_FILENO, (const uint8_t *)jpegData.bytes, len) != 0) {
            self.stopped = YES;
            exit(0);
        }
    }
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    self.stopped = YES;
    exit(error ? 1 : 0);
}

@end

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc > 1 && strcmp(argv[1], "--check") == 0) {
            return CGPreflightScreenCaptureAccess() ? 0 : 10;
        }
        if (argc > 1 && strcmp(argv[1], "--request") == 0) {
            CGRequestScreenCaptureAccess();
            return CGPreflightScreenCaptureAccess() ? 0 : 10;
        }
        if (!CGPreflightScreenCaptureAccess()) {
            return 10;
        }

        int maxWidth = (argc > 1) ? atoi(argv[1]) : 800;
        double quality = (argc > 2) ? atof(argv[2]) : 0.50;
        int targetFps = (argc > 3) ? atoi(argv[3]) : 22;
        int displayIdx = (argc > 4) ? atoi(argv[4]) : 0;

        if (maxWidth < 320) maxWidth = 320;
        if (maxWidth > 1600) maxWidth = 1600;
        if (quality < 0.20) quality = 0.20;
        if (quality > 0.92) quality = 0.92;
        if (targetFps < 1) targetFps = 1;
        if (targetFps > 30) targetFps = 30;

        dispatch_semaphore_t readySem = dispatch_semaphore_create(0);
        __block SCStream *activeStream = nil;
        __block StreamDelegate *delegate = [[StreamDelegate alloc] initWithQuality:quality];
        __block int exitCode = 0;

        [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                                   onScreenWindowsOnly:YES
                                                     completionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
            if (error || !content || content.displays.count == 0) {
                exitCode = 2;
                dispatch_semaphore_signal(readySem);
                return;
            }

            NSUInteger idx = (displayIdx >= 0 && (NSUInteger)displayIdx < content.displays.count)
                ? (NSUInteger)displayIdx
                : 0;
            SCDisplay *display = content.displays[idx];

            double dispW = (double)display.width;
            double dispH = (double)display.height;
            if (dispW <= 0 || dispH <= 0) { dispW = 1440; dispH = 900; }

            int outW = (dispW > maxWidth) ? maxWidth : (int)dispW;
            int outH = (int)((double)outW * (dispH / dispW));
            outW = (outW / 2) * 2;
            outH = (outH / 2) * 2;
            if (outH < 180) outH = 180;

            SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
            SCStreamConfiguration *cfg = [[SCStreamConfiguration alloc] init];
            cfg.width = (size_t)outW;
            cfg.height = (size_t)outH;
            cfg.minimumFrameInterval = CMTimeMake(1, targetFps);
            cfg.pixelFormat = kCVPixelFormatType_32BGRA;
            cfg.showsCursor = YES;
            cfg.queueDepth = 3;

            SCStream *stream = [[SCStream alloc] initWithFilter:filter configuration:cfg delegate:delegate];
            dispatch_queue_t q = dispatch_queue_create("devdeck.screen.stream", DISPATCH_QUEUE_SERIAL);
            NSError *addErr = nil;
            [stream addStreamOutput:delegate type:SCStreamOutputTypeScreen sampleHandlerQueue:q error:&addErr];
            if (addErr) {
                exitCode = 3;
                dispatch_semaphore_signal(readySem);
                return;
            }

            activeStream = stream;
            [stream startCaptureWithCompletionHandler:^(NSError * _Nullable startErr) {
                if (startErr) {
                    exitCode = 4;
                    dispatch_semaphore_signal(readySem);
                }
            }];
        }];

        // Keep running until EOF on stdout or stream error
        dispatch_semaphore_wait(readySem, DISPATCH_TIME_FOREVER);
        (void)activeStream;
        return exitCode;
    }
}
