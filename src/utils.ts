import sdk, {
  EventListenerRegister,
  HumiditySensor,
  ScryptedDeviceBase,
  ScryptedInterface,
  Setting,
  Thermometer,
  ObjectsDetected,
} from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";

export const updateCameraConfigurationRegex = new RegExp("overlay:(.*):update");
export const AMCREST_DAHUA_UTILITIES_INTERFACE = `AMCREST_DAHUA_UTILITIES`;
export const deviceFilter = `['${ScryptedInterface.Thermometer}','${ScryptedInterface.HumiditySensor}','${ScryptedInterface.Lock}'].some(elem => interfaces.includes(elem))`;
export const pluginEnabledFilter = `interfaces.includes('${AMCREST_DAHUA_UTILITIES_INTERFACE}')`;

export type SupportedDevice = ScryptedDeviceBase & (Thermometer | HumiditySensor);

export enum OverlayType {
  Text = "Text",
  Device = "Device",
  FaceDetection = "FaceDetection",
}

export enum ListenerType {
  Face = "Face",
  Humidity = "Humidity",
  Temperature = "Temperature",
  Lock = "Lock",
}

export type ListenersMap = Record<
  string,
  { listenerType: ListenerType; listener: EventListenerRegister; device?: string }
>;

export type OnUpdateOverlayFn = (props: {
  overlayId: string;
  listenerType: ListenerType;
  listenInterface?: ScryptedInterface;
  data?: any;
  device?: ScryptedDeviceBase;
}) => Promise<void>;

interface Overlay {
  text: string;
  type: OverlayType;
  device: string;
  prefix: string;
}

export const getOverlayKeys = (overlayId: string) => {
  const textKey = `overlay:${overlayId}:text`;
  const typeKey = `overlay:${overlayId}:type`;
  const prefixKey = `overlay:${overlayId}:prefix`;
  const deviceKey = `overlay:${overlayId}:device`;
  const updateKey = `overlay:${overlayId}:update`;
  return {
    textKey,
    typeKey,
    prefixKey,
    deviceKey,
    updateKey,
  };
};

export const getOverlaySettings = (props: {
  storage: StorageSettings<any>;
  overlayIds: string[];
}): Setting[] => {
  const { storage, overlayIds } = props;
  const settings: Setting[] = [];
  for (const overlayId of overlayIds) {
    const overlayName = `Overlay ${overlayId}`;
    const { deviceKey, typeKey, prefixKey, textKey } = getOverlayKeys(overlayId);
    const type = storage.getItem(typeKey) ?? OverlayType.Text;

    settings.push(
      {
        key: typeKey,
        title: "Type",
        type: "string",
        choices: [
          OverlayType.Text,
          OverlayType.Device,
          OverlayType.FaceDetection,
        ],
        subgroup: overlayName,
        value: type,
        immediate: true,
      }
    );

    if (type === OverlayType.Text) {
      settings.push({
        key: textKey,
        title: "Text",
        type: "string",
        subgroup: overlayName,
        value: storage.getItem(textKey),
      });
    }

    const prefixSetting: Setting = {
      key: prefixKey,
      title: 'Prefix',
      type: 'string',
      subgroup: overlayName,
      value: storage.getItem(prefixKey),
    };

    if (type === OverlayType.Device) {
      settings.push(
        {
          key: deviceKey,
          title: 'Device',
          type: 'device',
          subgroup: overlayName,
          deviceFilter,
          immediate: true,
          value: storage.getItem(deviceKey)
        },
        prefixSetting
      );
    } else if (type === OverlayType.FaceDetection) {
      settings.push(prefixSetting);
    }
  }

  return settings;
}

export const getOverlay = (props: {
  storage: StorageSettings<any>;
  overlayId: string;
}): Overlay => {
  const { storage, overlayId } = props;
  const { deviceKey, typeKey, prefixKey, textKey } = getOverlayKeys(overlayId);
  const type = storage.getItem(typeKey) ?? OverlayType.Text;
  const device = storage.getItem(deviceKey);
  const text = storage.getItem(textKey);
  const prefix = storage.getItem(prefixKey);
  return {
    device,
    type,
    prefix,
    text,
  };
};

export const listenersIntevalFn = (props: {
  overlayIds: string[];
  storage: StorageSettings<any>;
  console: Console;
  id: string;
  currentListeners: ListenersMap;
  onUpdateFn: OnUpdateOverlayFn;
}) => {
  const { overlayIds, storage, console, id, currentListeners, onUpdateFn } = props;
  for (const overlayId of overlayIds) {
    const overlay = getOverlay({ overlayId, storage });
    const overlayType = overlay.type;
    let listenerType: ListenerType;
    let listenInterface: ScryptedInterface;
    let deviceId: string;
    if (overlayType === OverlayType.Device) {
      const realDevice = sdk.systemManager.getDeviceById(overlay.device);
      if (realDevice) {
        if (realDevice.interfaces.includes(ScryptedInterface.Thermometer)) {
          listenerType = ListenerType.Temperature;
          listenInterface = ScryptedInterface.Thermometer;
          deviceId = overlay.device;
        } else if (realDevice.interfaces.includes(ScryptedInterface.HumiditySensor)) {
          listenerType = ListenerType.Humidity;
          listenInterface = ScryptedInterface.HumiditySensor;
          deviceId = overlay.device;
        }
        // else if (realDevice.interfaces.includes(ScryptedInterface.Entry)) {
        //   listenerType = ListenerType.Cover;
        //   listenInterface = ScryptedInterface.Entry;
        //   deviceId = overlay.device;
        // }
        else if (realDevice.interfaces.includes(ScryptedInterface.Lock)) {
          listenerType = ListenerType.Lock;
          listenInterface = ScryptedInterface.Lock;
          deviceId = overlay.device;
        }
      } else {
        console.log(`Device ${overlay.device} not found`);
      }
    } else if (overlayType === OverlayType.FaceDetection) {
      listenerType = ListenerType.Face;
      listenInterface = ScryptedInterface.ObjectDetector;
      deviceId = id;
    }
    const currentListener = currentListeners[overlayId];
    const currentDevice = currentListener?.device;
    const differentType = (!currentListener || currentListener.listenerType !== listenerType);
    const differentDevice = overlay.type === OverlayType.Device ? currentDevice !== overlay.device : false;
    if (listenerType && listenInterface && deviceId && (differentType || differentDevice)) {
      const realDevice = sdk.systemManager.getDeviceById<ScryptedDeviceBase>(deviceId);
      console.log(`Overlay ${overlayId}: starting device ${realDevice.name} listener for type ${listenerType} on interface ${listenInterface}`);
      if (currentListener?.listener) {
        currentListener.listener.removeListener();
      }
      const newListener = realDevice.listen(listenInterface, async (_, __, data) => {
        await onUpdateFn({
          listenInterface,
          overlayId,
          data,
          listenerType,
          device: realDevice,
        });
      });
      currentListeners[overlayId] = {
        listenerType,
        device: overlay.device,
        listener: newListener,
      };
    }
    if (overlayType === OverlayType.Text) {
      if (currentListener?.listener) {
        console.log(`Removing listener for text overlay ${overlayId}`);
        currentListener.listener.removeListener();
        delete currentListeners[overlayId];
      }
    }
  }
};

export const parseOverlayData = (props: {
  listenerType: ListenerType;
  data: any;
  overlay: Overlay;
  parseNumber?: (input: number) => string;
}) => {
  const { listenerType, data, overlay, parseNumber } = props;
  const { prefix, text } = overlay;
  let textToUpdate = text;
  if (listenerType === ListenerType.Face) {
    const label = (data as ObjectsDetected)?.detections?.find((det) => det.className === "face")?.label;
    textToUpdate = label;
  } else if (listenerType === ListenerType.Temperature) {
    const realDevice = overlay.device ? sdk.systemManager.getDeviceById(overlay.device) as any : undefined;
    textToUpdate = `${prefix || ""}${parseNumber ? parseNumber(data) : data} ${realDevice?.temperatureUnit || ""}`;
  } else if (listenerType === ListenerType.Humidity) {
    textToUpdate = `${prefix || ""}${parseNumber ? parseNumber(data) : data} %`;
    // } else if (listenerType === ListenerType.Cover) {
    //   textToUpdate = `${prefix || ""}${data}`;
  } else if (listenerType === ListenerType.Lock) {
    textToUpdate = `${prefix || ""}${data}`;
  }
  return textToUpdate;
};
