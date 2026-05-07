import { PermissionsAndroid, Platform } from 'react-native'
import { Base64 } from 'js-base64'
import { BleManager, Device, State, Subscription } from 'react-native-ble-plx'

const HEART_RATE_SERVICE_UUID = '180D'
const HEART_RATE_MEASUREMENT_UUID = '2A37'

export type HeartRateDiscovery = {
  id: string
  name: string
  rssi: number | null
}

export type HeartRateReading = {
  bpm: number
  sampledAt: string
  contactDetected: boolean
  rrIntervalsMs: number[]
}

function parseHeartRateMeasurement(value: string): HeartRateReading | null {
  const bytes = Uint8Array.from(Base64.toUint8Array(value))
  if (bytes.length < 2) {
    return null
  }

  const flags = bytes[0]
  const isUint16 = (flags & 0x01) === 0x01
  const contactDetected = (flags & 0x02) === 0x02
  const hasEnergyExpended = (flags & 0x08) === 0x08
  const hasRrIntervals = (flags & 0x10) === 0x10

  let cursor = 1
  let bpm = bytes[cursor]
  if (isUint16) {
    if (bytes.length < 3) {
      return null
    }
    bpm = bytes[cursor] | (bytes[cursor + 1] << 8)
    cursor += 2
  } else {
    cursor += 1
  }

  if (hasEnergyExpended) {
    cursor += 2
  }

  const rrIntervalsMs: number[] = []
  if (hasRrIntervals) {
    while (cursor + 1 < bytes.length) {
      const interval = bytes[cursor] | (bytes[cursor + 1] << 8)
      rrIntervalsMs.push(Math.round((interval / 1024) * 1000))
      cursor += 2
    }
  }

  return {
    bpm,
    sampledAt: new Date().toISOString(),
    contactDetected,
    rrIntervalsMs,
  }
}

async function ensureBlePermissions() {
  if (Platform.OS !== 'android') {
    return true
  }

  const requested = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ])

  return Object.values(requested).every((value) => value === PermissionsAndroid.RESULTS.GRANTED)
}

class HeartRateBeltClient {
  private manager: BleManager | null = new BleManager()
  private scanActive = false
  private monitorSubscription: Subscription | null = null
  private connectedDevice: Device | null = null

  private getManager() {
    if (!this.manager) {
      this.manager = new BleManager()
    }

    return this.manager
  }

  async scanForBelts(onDiscovered: (device: HeartRateDiscovery) => void) {
    const permissionsGranted = await ensureBlePermissions()
    if (!permissionsGranted) {
      throw new Error('Bluetooth permissions were denied.')
    }

    const manager = this.getManager()
    const state = await manager.state()
    if (state !== State.PoweredOn) {
      throw new Error('Bluetooth is not powered on.')
    }

    this.stopScan()
    this.scanActive = true
    const discovered = new Set<string>()

    manager.startDeviceScan([HEART_RATE_SERVICE_UUID], null, (error, device) => {
      if (error) {
        console.warn('BLE scan error', error.message)
        return
      }

      if (!device || discovered.has(device.id)) {
        return
      }

      discovered.add(device.id)
      onDiscovered({
        id: device.id,
        name: device.name ?? device.localName ?? 'Heart-rate belt',
        rssi: device.rssi ?? null,
      })
    })
  }

  stopScan() {
    if (!this.scanActive) {
      return
    }

    this.manager?.stopDeviceScan()
    this.scanActive = false
  }

  async connect(deviceId: string, onReading: (reading: HeartRateReading) => void) {
    this.stopScan()
    await this.disconnect()

    const manager = this.getManager()
    const device = await manager.connectToDevice(deviceId, { autoConnect: false })
    const discovered = await device.discoverAllServicesAndCharacteristics()
    this.connectedDevice = discovered

    this.monitorSubscription = discovered.monitorCharacteristicForService(
      HEART_RATE_SERVICE_UUID,
      HEART_RATE_MEASUREMENT_UUID,
      (error, characteristic) => {
        if (error || !characteristic?.value) {
          if (error) {
            console.warn('BLE monitor error', error.message)
          }
          return
        }

        const reading = parseHeartRateMeasurement(characteristic.value)
        if (reading) {
          onReading(reading)
        }
      }
    )

    return {
      id: discovered.id,
      name: discovered.name ?? discovered.localName ?? 'Heart-rate belt',
    }
  }

  async disconnect() {
    this.monitorSubscription?.remove()
    this.monitorSubscription = null

    if (this.connectedDevice) {
      try {
        await this.connectedDevice.cancelConnection()
      } catch {
        // ignore stale disconnects
      }
    }

    this.connectedDevice = null
  }

  destroy() {
    this.stopScan()
    void this.disconnect()
    this.manager?.destroy()
    this.manager = null
  }
}

export const heartRateBeltClient = new HeartRateBeltClient()
