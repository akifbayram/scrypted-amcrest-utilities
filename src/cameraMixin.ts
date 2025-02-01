import sdk, {
    EventListenerRegister,
    ObjectsDetected,
    ScryptedDeviceType,
    ScryptedInterface,
    Setting,
    Settings,
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
  } from "./utils";
  
  export default class AmcrestDahuaUtilitiesMixin
    extends SettingsMixinDeviceBase<any>
    implements Settings
  {
    client: AmcrestDahuaCameraAPI;
    killed: boolean;
    overlayIds: string[] = [];
    lastFaceDetected: string;
    detectionListener: EventListenerRegister;
  
    storageSettings = new StorageSettings(this, {
      updateInterval: {
        title: "Update interval in seconds",
        type: "number",
        defaultValue: 10,
      },
      getCurrentOverlayConfigurations: {
        title: "Get current overlay configurations",
        type: "button",
      },
      duplicateFromDevice: {
        title: "Duplicate from device",
        description:
          "Duplicate OSD information from another device enabled on the plugin",
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
  
      if (key === "getCurrentOverlayConfigurations") {
        await this.getOverlayData();
      } else if (key === "duplicateFromDevice") {
        await this.duplicateFromDevice(value);
      } else if (updateOverlayMatch) {
        const overlayId = updateOverlayMatch[1];
        await this.updateOverlayData(overlayId);
      } else {
        this.storage.setItem(
          key,
          typeof value === "string" ? value : JSON.stringify(value)
        );
      }
    }
  
    async getOverlayData() {
        const client = await this.getClient();
        const result = await client.getOverlay();
        const overlayIds: string[] = [];
      
        // Check if the response is in plain text format
        if (result.config) {
          const config = result.config;
          // Look for keys that match the custom title text.
          // For example, keys like "table.VideoWidget[0].CustomTitle[<n>].Text"
          for (const key in config) {
            const match = key.match(/table\.VideoWidget\[0\]\.CustomTitle\[(\d+)\]\.Text$/);
            if (match) {
              const overlayId = match[1]; // e.g., "0", "1", etc.
              overlayIds.push(overlayId);
              const { textKey } = getOverlayKeys(overlayId);
              // Save the custom title text into the storage settings.
              this.storageSettings.putSetting(textKey, config[key]);
            }
          }
        } else if (result.json) {
          // (If for some reason the response is XML, use the XML structure.)
          const currentOverlay = result.json;
          const overlayEntries = currentOverlay.VideoWidget?.TextOverlayList?.[0]?.TextOverlay;
          this.console.log(JSON.stringify(overlayEntries));
          if (overlayEntries) {
            for (const overlayEntry of overlayEntries) {
              const id = overlayEntry.id?.[0];
              if (id) {
                overlayIds.push(id);
                const { textKey } = getOverlayKeys(id);
                this.storageSettings.putSetting(textKey, overlayEntry.displayText?.[0]);
              }
            }
          }
        } else {
          this.console.error("No valid overlay data found");
        }
        this.overlayIds = overlayIds;
      }
        
    async duplicateFromDevice(deviceId: string) {
      const deviceToDuplicate = this.plugin.mixinsMap[deviceId];
  
      if (deviceToDuplicate) {
        const duplicateClient = await deviceToDuplicate.getClient();
        const { json } = await duplicateClient.getOverlay();
  
        const client = await this.getClient();
        // (Optional) Duplicate the entire overlay configuration here.
        await this.getOverlayData();
  
        for (const overlayId of deviceToDuplicate.overlayIds) {
          const { device, type, prefix, text } = getOverlay({
            overlayId,
            storage: deviceToDuplicate.storageSettings,
          });
          const { deviceKey, typeKey, prefixKey, textKey } =
            getOverlayKeys(overlayId);
  
          await this.putMixinSetting(deviceKey, device);
          await this.putMixinSetting(typeKey, type);
          await this.putMixinSetting(prefixKey, prefix);
          await this.putMixinSetting(textKey, text);
        }
      }
    }
  
    async updateOverlayData(overlayId: string) {
        const client = await this.getClient();
        const { device, type, prefix, text } = getOverlay({
          overlayId,
          storage: this.storageSettings,
        });
      
        // If the user’s text is empty or only whitespace, substitute a single blank space.
        let textToUpdate = text.trim() === "" ? " " : text;
      
        if (type === OverlayType.Device && device) {
          const realDevice = sdk.systemManager.getDeviceById<SupportedDevice>(device);
          if (realDevice) {
            if (realDevice.interfaces.includes(ScryptedInterface.Thermometer)) {
              textToUpdate = `${prefix || ""}${realDevice.temperature} ${realDevice.temperatureUnit}`;
            } else if (realDevice.interfaces.includes(ScryptedInterface.HumiditySensor)) {
              textToUpdate = `${prefix || ""}${realDevice.humidity} %`;
            }
          }
        } else if (type === OverlayType.FaceDetection) {
          textToUpdate = `${prefix || ""}${this.lastFaceDetected || "-"}`;
        }
      
        await client.updateOverlayText(overlayId, textToUpdate);
      }
              
    checkEventListeners(props: { faceEnabled: boolean }) {
      const { faceEnabled } = props;
  
      if (faceEnabled) {
        if (!this.detectionListener) {
          this.console.log("Starting Object detection for faces");
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
        this.console.log("Stopping Object detection for faces");
        this.detectionListener?.removeListener();
        this.detectionListener = undefined;
      }
    }
  
    async init() {
      await this.getOverlayData();
  
      setInterval(async () => {
        let faceEnabled = false;
        for (const overlayId of this.overlayIds) {
          const overlay = getOverlay({
            overlayId,
            storage: this.storageSettings,
          });
  
          if (overlay.type !== OverlayType.Text) {
            await this.updateOverlayData(overlayId);
          }
  
          if (overlay.type === OverlayType.FaceDetection) {
            faceEnabled = true;
          }
        }
  
        this.checkEventListeners({ faceEnabled });
      }, this.storageSettings.values.updateInterval * 1000);
    }
  }
  