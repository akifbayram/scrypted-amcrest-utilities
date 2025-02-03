import sdk, {
  EventListenerRegister,
  ObjectsDetected,
  ScryptedDeviceBase,
  ScryptedInterface,
  Setting,
  Settings,
  LockState,
} from "@scrypted/sdk";
import {
  SettingsMixinDeviceBase,
  SettingsMixinDeviceOptions,
} from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import keyBy from "lodash/keyBy";
import AmcrestDahuaProvider from "./main";
import { AmcrestDahuaCameraAPI } from "./client";
import {
  getOverlayKeys,
  getOverlay,
  getOverlaySettings,
  updateCameraConfigurationRegex,
  SupportedDevice,
  pluginEnabledFilter,
  OverlayType,
  ListenerType,
  ListenersMap,
  OnUpdateOverlayFn,
  listenersIntevalFn,
  parseOverlayData,
} from "./utils";

export default class AmcrestDahuaUtilitiesMixin
  extends SettingsMixinDeviceBase<any>
  implements Settings {
  client: AmcrestDahuaCameraAPI;
  killed: boolean = false;
  overlayIds: string[] = [];
  lastFaceDetected: string;
  detectionListener: EventListenerRegister;
  listenersMap: ListenersMap = {};

  storageSettings = new StorageSettings(this, {
    duplicateFromDevice: {
      title: "Duplicate from Device",
      description:
        "Duplicate OSD from another device",
      type: "device",
      deviceFilter: pluginEnabledFilter,
      immediate: true,
    },
  });

  constructor(
    options: SettingsMixinDeviceOptions<any>,
    private plugin: AmcrestDahuaProvider
  ) {
    super(options);
    this.plugin.mixinsMap[this.id] = this;
    setTimeout(async () => {
      if (!this.killed) await this.init();
    }, 2000);
  }

  async release() {
    this.killed = true;
    if (this.detectionListener) {
      this.console.log("Removing face detection listener");
      this.detectionListener.removeListener();
      this.detectionListener = undefined;
    }
    Object.values(this.listenersMap).forEach(({ listener }) => {
      if (listener) {
        listener.removeListener();
      }
    });
    this.listenersMap = {};
  }

  async getDeviceProperties() {
    const deviceSettings = await this.mixinDevice.getSettings();
    const deviceSettingsMap = keyBy(deviceSettings, (setting) => setting.key);
    const username = deviceSettingsMap["username"]?.value;
    const password = deviceSettingsMap["password"]?.value;
    const host = deviceSettingsMap["ip"]?.value;
    const httpPort = deviceSettingsMap["httpPort"]?.value || 80;
    const channel = deviceSettingsMap["rtspChannel"]?.value ?? "1";
    const httpAddress = `${host}:${httpPort}`;
    return { username, password, httpAddress, channel, host };
  }

  async getClient() {
    if (!this.client) {
      const { channel, httpAddress, username, password } =
        await this.getDeviceProperties();
      this.client = new AmcrestDahuaCameraAPI(
        httpAddress,
        username,
        password,
        channel,
        this.console
      );
    }
    return this.client;
  }

  async getMixinSettings(): Promise<Setting[]> {
    const settings = await this.storageSettings.getSettings();
    settings.push(
      ...getOverlaySettings({
        storage: this.storageSettings,
        overlayIds: this.overlayIds,
      })
    );
    return settings;
  }

  async putMixinSetting(key: string, value: string) {
    const updateOverlayMatch = updateCameraConfigurationRegex.exec(key);
    if (key === "duplicateFromDevice") {
      await this.duplicateFromDevice(value);
    } else if (updateOverlayMatch) {
      const overlayId = updateOverlayMatch[1];
      await this.updateOverlayData(overlayId);
    }
    else if (/overlay:(.*):type/.test(key)) {
      this.storage.setItem(key, value);
      const match = key.match(/overlay:(.*):type/);
      if (match) {
        const overlayId = match[1];
        await this.updateOverlayData(overlayId);
      }
    }
    else if (/overlay:(.*):device/.test(key)) {
      this.storage.setItem(key, value);
      const match = key.match(/overlay:(.*):device/);
      if (match) {
        const overlayId = match[1];
        await this.updateOverlayData(overlayId);
      }
    }
    else if (/overlay:(.*):prefix/.test(key)) {
      this.storage.setItem(key, value);
      const match = key.match(/overlay:(.*):prefix/);
      if (match) {
        const overlayId = match[1];
        await this.updateOverlayData(overlayId);
      }
    }
    else if (/overlay:(.*):text/.test(key)) {
      this.storage.setItem(key, value);
      const match = key.match(/overlay:(.*):text/);
      if (match) {
        const overlayId = match[1];
        await this.updateOverlayData(overlayId);
      }
    } else {
      this.storage.setItem(
        key,
        typeof value === "string" ? value : JSON.stringify(value)
      );
    }
  }

  async getOverlayData() {
    try {
      const client = await this.getClient();
      const result = await client.getOverlay();
      const overlayIds: string[] = [];
      if (result.config) {
        const config = result.config;
        for (const key in config) {
          const match = key.match(
            /table\.VideoWidget\[0\]\.CustomTitle\[(\d+)\]\.Text$/
          );
          if (match) {
            const overlayId = match[1];
            overlayIds.push(overlayId);
            const { textKey } = getOverlayKeys(overlayId);
            this.storageSettings.putSetting(textKey, config[key]);
          }
        }
      } else if (result.json) {
        const currentOverlay = result.json;
        const overlayEntries =
          currentOverlay.VideoWidget?.TextOverlayList?.[0]?.TextOverlay;
        this.console.log("Overlay entries:", JSON.stringify(overlayEntries));
        if (overlayEntries) {
          for (const overlayEntry of overlayEntries) {
            const id = overlayEntry.id?.[0];
            if (id) {
              overlayIds.push(id);
              const { textKey } = getOverlayKeys(id);
              this.storageSettings.putSetting(
                textKey,
                overlayEntry.displayText?.[0]
              );
            }
          }
        }
      } else {
        this.console.error("No valid overlay data found");
      }
      this.overlayIds = overlayIds;
    } catch (e) {
      this.console.error("Error in getOverlayData", e);
    }
  }

  async duplicateFromDevice(deviceId: string) {
    const deviceToDuplicate = this.plugin.mixinsMap[deviceId];
    if (deviceToDuplicate) {
      try {
        // Remove text key from duplication
        for (const overlayId of deviceToDuplicate.overlayIds) {
          const { device, type, prefix } = getOverlay({
            overlayId,
            storage: deviceToDuplicate.storageSettings,
          });
          const { deviceKey, typeKey, prefixKey } = getOverlayKeys(overlayId);

          await this.putMixinSetting(deviceKey, device);
          await this.putMixinSetting(typeKey, type);
          await this.putMixinSetting(prefixKey, prefix);
        }
      } catch (e) {
        this.console.error("Error in duplicateFromDevice", e);
      }
    }
  }

  private updateOverlayDataEvent: OnUpdateOverlayFn = async (props) => {
    const { overlayId, listenerType, data, device } = props;
    this.console.log(
      `Update received from device ${device?.name} for overlay ${overlayId}`
    );
    try {
      const overlay = getOverlay({ overlayId, storage: this.storageSettings });
      const textToUpdate = parseOverlayData({ listenerType, data, overlay });
      if (textToUpdate.trim() === "") {
        await (await this.getClient()).disableOverlayText(overlayId);
      } else {
        await (await this.getClient()).updateOverlayText(overlayId, textToUpdate);
      }
    } catch (e) {
      this.console.error("Error in updateOverlayDataEvent", e);
    }
  };

  async updateOverlayData(overlayId: string) {
    try {
      const client = await this.getClient();
      const { device, type, prefix, text } = getOverlay({
        overlayId,
        storage: this.storageSettings,
      });
      let textToUpdate = text.trim();
      if (type === OverlayType.Device && device) {
        const realDevice = sdk.systemManager.getDeviceById<SupportedDevice>(device);
        if (realDevice) {
          if (realDevice.interfaces.includes(ScryptedInterface.Thermometer)) {
            textToUpdate = `${prefix || ""}${realDevice.temperature} ${realDevice.temperatureUnit}`;
          } else if (realDevice.interfaces.includes(ScryptedInterface.HumiditySensor)) {
            textToUpdate = `${prefix || ""}${realDevice.humidity} %`;
          } else if (realDevice.interfaces.includes(ScryptedInterface.Lock)) {
            textToUpdate = `${prefix || ""}${realDevice.lockState}`;
          }
        }
      } else if (type === OverlayType.FaceDetection) {
        textToUpdate = `${prefix || ""}${this.lastFaceDetected || "-"}`;
      }
      if (textToUpdate === "") {
        await client.disableOverlayText(overlayId);
      } else {
        await client.updateOverlayText(overlayId, textToUpdate);
      }
    } catch (e) {
      this.console.error(`Error updating overlay ${overlayId}:`, e);
    }
  }

  async init() {
    try {
      await this.getOverlayData();
      listenersIntevalFn({
        console: this.console,
        currentListeners: this.listenersMap,
        id: this.id,
        onUpdateFn: this.updateOverlayDataEvent,
        overlayIds: this.overlayIds,
        storage: this.storageSettings,
      });
      await this.getOverlayData();
      const faceEnabled = this.overlayIds.some((overlayId) => {
        const overlay = getOverlay({ overlayId, storage: this.storageSettings });
        return overlay.type === OverlayType.FaceDetection;
      });
      if (faceEnabled) {
        if (!this.detectionListener) {
          this.console.log("Starting object detection for faces");
          this.detectionListener = sdk.systemManager.listenDevice(
            this.id,
            ScryptedInterface.ObjectDetector,
            async (_, __, data) => {
              const detection: ObjectsDetected = data;
              const faceLabel = detection.detections.find(
                (det) => det.className === "face" && det.label
              )?.label;
              if (faceLabel) {
                this.console.log(`Face detected: ${faceLabel}`);
                this.lastFaceDetected = faceLabel;
              }
            }
          );
        }
      } else if (this.detectionListener) {
        this.console.log("Stopping object detection for faces");
        this.detectionListener.removeListener();
        this.detectionListener = undefined;
      }
    } catch (e) {
      this.console.error("Error in init", e);
    }
  }
}
