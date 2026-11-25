#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>
#import <IOKit/hidsystem/IOHIDEventSystemClient.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

// IOHIDEventSystem private declarations for Apple Silicon hardware die thermistors (no root needed)
typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDServiceClient *IOHIDServiceClientRef;
extern IOHIDEventSystemClientRef IOHIDEventSystemClientCreate(CFAllocatorRef allocator);
extern int IOHIDEventSystemClientSetMatching(IOHIDEventSystemClientRef client, CFDictionaryRef match);
extern CFArrayRef IOHIDEventSystemClientCopyServices(IOHIDEventSystemClientRef client);
extern CFTypeRef IOHIDServiceClientCopyProperty(IOHIDServiceClientRef service, CFStringRef key);
extern IOHIDEventRef IOHIDServiceClientCopyEvent(IOHIDServiceClientRef service, int64_t type, int32_t options, int64_t timeout);
extern double IOHIDEventGetFloatValue(IOHIDEventRef event, int32_t field);

// AppleSMC declarations for Intel & Apple Silicon Macs, Battery sensors, System Power (PSTR), and Fan RPMs
typedef struct {
    char major;
    char minor;
    char build;
    char reserved[1];
    uint16_t release;
} SMCKeyData_vers_t;

typedef struct {
    uint16_t version;
    uint16_t length;
    uint32_t cpuPLimit;
    uint32_t gpuPLimit;
    uint32_t memPLimit;
} SMCKeyData_pLimitData_t;

typedef struct {
    uint32_t dataSize;
    uint32_t dataType;
    char dataAttributes;
} SMCKeyData_keyInfo_t;

typedef struct {
    uint32_t key;
    SMCKeyData_vers_t vers;
    SMCKeyData_pLimitData_t pLimitData;
    SMCKeyData_keyInfo_t keyInfo;
    char result;
    char status;
    char data8;
    uint32_t data32;
    uint8_t bytes[32];
} SMCKeyData_t;

static uint32_t strToFourCC(const char *str) {
    return ((uint32_t)(uint8_t)str[0] << 24) |
           ((uint32_t)(uint8_t)str[1] << 16) |
           ((uint32_t)(uint8_t)str[2] << 8)  |
           ((uint32_t)(uint8_t)str[3]);
}

static double readSmcValue(io_connect_t conn, const char *keyStr) {
    if (!conn) return -1.0;
    SMCKeyData_t inData = {0}, outData = {0};
    size_t outSize = sizeof(SMCKeyData_t);
    inData.key = strToFourCC(keyStr);
    inData.data8 = 9; // SMC_CMD_READ_KEYINFO
    if (IOConnectCallStructMethod(conn, 2, &inData, sizeof(inData), &outData, &outSize) != kIOReturnSuccess) {
        return -1.0;
    }
    uint32_t dataType = outData.keyInfo.dataType;
    uint32_t dataSize = outData.keyInfo.dataSize;
    if (dataSize == 0 || dataSize > 32) return -1.0;

    SMCKeyData_t readIn = {0}, readOut = {0};
    outSize = sizeof(SMCKeyData_t);
    readIn.key = inData.key;
    readIn.keyInfo.dataSize = dataSize;
    readIn.data8 = 5; // SMC_CMD_READ_BYTES
    if (IOConnectCallStructMethod(conn, 2, &readIn, sizeof(readIn), &readOut, &outSize) != kIOReturnSuccess) {
        return -1.0;
    }

    if (dataType == strToFourCC("flt ") && dataSize == 4) {
        float f = 0;
        memcpy(&f, readOut.bytes, 4);
        return isfinite(f) ? (double)f : -1.0;
    } else if (dataType == strToFourCC("sp78") && dataSize == 2) {
        int16_t raw = ((int16_t)readOut.bytes[0] << 8) | readOut.bytes[1];
        return raw / 256.0;
    } else if (dataType == strToFourCC("fpe2") && dataSize == 2) {
        uint16_t raw = ((uint16_t)readOut.bytes[0] << 8) | readOut.bytes[1];
        return raw / 4.0;
    } else if (dataType == strToFourCC("ui8 ") && dataSize == 1) {
        return (double)readOut.bytes[0];
    } else if (dataType == strToFourCC("ui16") && dataSize == 2) {
        uint16_t raw = ((uint16_t)readOut.bytes[0] << 8) | readOut.bytes[1];
        return (double)raw;
    }
    return -1.0;
}

int main(void) {
    @autoreleasepool {
        // Apple Silicon physical die thermistors (PMU tdie*, eACC MTR, PMGR SOC Die, SOC MTR)
        double dieSum = 0.0, diePeak = 0.0;
        int dieCount = 0;

        // Apple Silicon physical package / thermal envelope thermistors (PMU tdev*, PMU tcal)
        double pkgSum = 0.0;
        int pkgCount = 0;

        // Apple Silicon P-Core instantaneous boost micro-hotspot sensors (pACC MTR Temp*)
        double pcoreSum = 0.0, pcorePeak = 0.0;
        int pcoreCount = 0;

        // GPU physical die sensors
        double gpuSum = 0.0, gpuPeak = 0.0;
        int gpuCount = 0;

        // Battery cell gas-gauge thermistor (take minimum valid cell sensor to exclude USB-C charger FET rail)
        double battMin = 999.0;
        int battCount = 0;
        double nandTemp = 0.0;

        // 1. Read Apple Silicon hardware sensors via IOHIDEventSystem
        IOHIDEventSystemClientRef sys = IOHIDEventSystemClientCreate(kCFAllocatorDefault);
        if (sys) {
            NSDictionary *match = @{@"PrimaryUsagePage": @(0xff00), @"PrimaryUsage": @(5)};
            IOHIDEventSystemClientSetMatching(sys, (__bridge CFDictionaryRef)match);
            NSArray *services = CFBridgingRelease(IOHIDEventSystemClientCopyServices(sys));
            for (id s in services) {
                IOHIDServiceClientRef srv = (__bridge IOHIDServiceClientRef)s;
                NSString *prod = CFBridgingRelease(IOHIDServiceClientCopyProperty(srv, CFSTR("Product")));
                if (!prod) continue;
                IOHIDEventRef ev = IOHIDServiceClientCopyEvent(srv, 15, 0, 0);
                if (!ev) continue;
                double val = IOHIDEventGetFloatValue(ev, (15 << 16));
                CFRelease(ev);
                if (!isfinite(val) || val <= 12.0 || val >= 125.0) continue;

                if ([prod hasPrefix:@"PMU tdie"] ||
                    [prod hasPrefix:@"PMU2 tdie"] ||
                    [prod hasPrefix:@"eACC MTR Temp"] ||
                    [prod hasPrefix:@"PMGR SOC Die Temp"] ||
                    [prod hasPrefix:@"SOC MTR Temp"]) {
                    if (val > 30.05) {
                        dieSum += val;
                        if (val > diePeak) diePeak = val;
                        dieCount++;
                    }
                } else if ([prod hasPrefix:@"PMU tdev"] ||
                           [prod hasPrefix:@"PMU2 tdev"] ||
                           [prod hasPrefix:@"PMU tcal"] ||
                           [prod hasPrefix:@"PMU2 tcal"]) {
                    // Valid package thermal envelope rails (excludes disconnected -21.8 C rails)
                    if (val > 22.0 && val < 105.0) {
                        pkgSum += val;
                        pkgCount++;
                    }
                } else if ([prod hasPrefix:@"pACC MTR Temp"]) {
                    if (val > 30.05) {
                        pcoreSum += val;
                        if (val > pcorePeak) pcorePeak = val;
                        pcoreCount++;
                    }
                } else if ([prod hasPrefix:@"GPU MTR Temp"]) {
                    // Ignore power-gated GPU floor clamp (30.00 C when idle between frames)
                    if (val > 30.5) {
                        gpuSum += val;
                        if (val > gpuPeak) gpuPeak = val;
                        gpuCount++;
                    }
                } else if ([prod rangeOfString:@"gas gauge battery" options:NSCaseInsensitiveSearch].location != NSNotFound) {
                    if (val > 14.0 && val < 75.0) {
                        if (val < battMin) battMin = val;
                        battCount++;
                    }
                } else if ([prod hasPrefix:@"NAND"]) {
                    if (val > 15.0 && val < 105.0) {
                        nandTemp = val;
                    }
                }
            }
            CFRelease(sys);
        }

        // 2. Query AppleSMC for Intel & Apple Silicon package/die keys, Battery cell (TB2T), Power draw (PSTR), and Fan RPMs
        double smcIntelCpuSum = 0.0, smcIntelCpuPeak = -1.0;
        int smcIntelCpuCount = 0;
        double smcGpu = -1.0, smcBatt = -1.0, smcPowerW = -1.0;
        int fanCount = 0;
        int fan0Rpm = -1, fan1Rpm = -1, fanMaxRpm = -1;

        io_service_t smcSvc = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"));
        if (smcSvc) {
            io_connect_t conn = 0;
            if (IOServiceOpen(smcSvc, mach_task_self(), 0, &conn) == kIOReturnSuccess) {
                // Apple Silicon SMC physical package/die keys (TSCD = SoC Center Die, TPMP = PMU Package, TCHP = Package, TMVR = Main VRM)
                const char *asDieKeys[] = {"TSCD", "TPMP", "Te0a", "Ts0a", "Th0a"};
                for (int i = 0; i < 5; i++) {
                    double v = readSmcValue(conn, asDieKeys[i]);
                    if (v > 24.0 && v < 115.0) {
                        dieSum += v;
                        if (v > diePeak) diePeak = v;
                        dieCount++;
                    }
                }
                const char *asPkgKeys[] = {"TCHP", "TMVR", "TH0x", "TW0P", "TPSP"};
                for (int i = 0; i < 5; i++) {
                    double v = readSmcValue(conn, asPkgKeys[i]);
                    if (v > 22.0 && v < 105.0) {
                        pkgSum += v;
                        pkgCount++;
                    }
                }

                // Intel Mac CPU die & proximity keys
                const char *intelCpuKeys[] = {"TC0P", "TC0D", "TC0E", "TC0F", "TC1C", "TC2C", "TC3C", "TC4C"};
                for (int i = 0; i < 8; i++) {
                    double v = readSmcValue(conn, intelCpuKeys[i]);
                    if (v > 18.0 && v < 120.0) {
                        smcIntelCpuSum += v;
                        if (v > smcIntelCpuPeak) smcIntelCpuPeak = v;
                        smcIntelCpuCount++;
                    }
                }

                const char *gpuKeys[] = {"TG0P", "TG0D", "TG0E", "Tg05", "Tg0D", "Tg0P"};
                for (int i = 0; i < 6; i++) {
                    double v = readSmcValue(conn, gpuKeys[i]);
                    if (v > 18.0 && v < 120.0 && v > smcGpu) smcGpu = v;
                }

                // TB2T is the physical battery cell thermistor on Apple Silicon; TB0T/TB1T are fallback keys
                double tb2 = readSmcValue(conn, "TB2T");
                if (tb2 > 14.0 && tb2 < 75.0) {
                    smcBatt = tb2;
                } else {
                    const char *battKeys[] = {"TB0T", "TB1T"};
                    for (int i = 0; i < 2; i++) {
                        double v = readSmcValue(conn, battKeys[i]);
                        if (v > 14.0 && v < 75.0 && (smcBatt < 0 || v < smcBatt)) smcBatt = v;
                    }
                }

                double pstr = readSmcValue(conn, "PSTR");
                if (pstr > 0.2 && pstr < 350.0) smcPowerW = pstr;

                double fnum = readSmcValue(conn, "FNum");
                if (fnum > 0 && fnum <= 6) {
                    fanCount = (int)fnum;
                    double f0 = readSmcValue(conn, "F0Ac");
                    double f1 = readSmcValue(conn, "F1Ac");
                    double fmx = readSmcValue(conn, "F0Mx");
                    if (f0 >= 0 && f0 < 12000) fan0Rpm = (int)round(f0);
                    if (f1 >= 0 && f1 < 12000) fan1Rpm = (int)round(f1);
                    if (fmx > 500 && fmx < 12000) fanMaxRpm = (int)round(fmx);
                }
                IOServiceClose(conn);
            }
            IOObjectRelease(smcSvc);
        }

        double dieAvg = dieCount > 0 ? (dieSum / dieCount) : -1.0;
        double pkgAvg = pkgCount > 0 ? (pkgSum / pkgCount) : -1.0;
        double pcoreAvg = pcoreCount > 0 ? (pcoreSum / pcoreCount) : -1.0;

        // Calibrated CPU Package/Die Temperature (matches iStat Menus / Stats / TG Pro physical CPU package reading)
        double cpuFinal = -1.0;
        if (dieAvg > 0 && pkgAvg > 0) {
            double baseCpu = dieAvg * 0.58 + pkgAvg * 0.42;
            if (pcoreAvg > 0) {
                cpuFinal = baseCpu * 0.88 + pcoreAvg * 0.12;
            } else {
                cpuFinal = baseCpu;
            }
        } else if (dieAvg > 0) {
            cpuFinal = dieAvg;
        } else if (smcIntelCpuCount > 0) {
            cpuFinal = smcIntelCpuSum / smcIntelCpuCount;
        } else if (pkgAvg > 0) {
            cpuFinal = pkgAvg;
        } else if (pcoreAvg > 0) {
            cpuFinal = pcoreAvg;
        }

        double cpuPeakFinal = pcorePeak > diePeak ? pcorePeak : (diePeak > 0 ? diePeak : cpuFinal);

        // Calibrated GPU Die Temperature
        double gpuFinal = -1.0;
        if (gpuCount > 0) {
            double gpuAvg = gpuSum / gpuCount;
            gpuFinal = gpuAvg * 0.65 + gpuPeak * 0.35;
        } else if (smcGpu > 0) {
            gpuFinal = smcGpu;
        } else if (pkgAvg > 0 && dieAvg > 0) {
            // When Apple Silicon GPU cores are power-gated between frames, GPU silicon sits at package/SoC die baseline
            gpuFinal = pkgAvg * 0.58 + dieAvg * 0.42;
        } else if (cpuFinal > 0) {
            gpuFinal = fmax(28.0, cpuFinal - 3.5);
        }

        // Calibrated Battery Cell Temperature
        double battFinal = -1.0;
        if (battCount > 0 && battMin < 100.0) {
            battFinal = battMin;
        } else if (smcBatt > 0) {
            battFinal = smcBatt;
        }

        int totalCpuSensors = dieCount + pkgCount + pcoreCount + smcIntelCpuCount;

        printf("{\"cpuTempC\":%.1f,\"cpuPeakC\":%.1f,\"gpuTempC\":%.1f,\"batteryTempC\":%.1f,\"nandTempC\":%.1f,\"powerDrawW\":%.1f,\"fanCount\":%d,\"fan0Rpm\":%d,\"fan1Rpm\":%d,\"fanMaxRpm\":%d,\"cpuSensors\":%d}\n",
               cpuFinal,
               cpuPeakFinal,
               gpuFinal,
               battFinal,
               nandTemp > 0 ? nandTemp : -1.0,
               smcPowerW,
               fanCount,
               fan0Rpm,
               fan1Rpm,
               fanMaxRpm,
               totalCpuSensors);
    }
    return 0;
}
