export interface VideoWidgetRoot {
    VideoWidget: VideoWidget;
  }
  
  export interface VideoWidget {
    $: VideoWidgetClass;
    CustomTitleList?: CustomTitleListElement[];
  }
  
  export interface VideoWidgetClass {
    version: string;
    xmlns: string;
  }
  
  export interface CustomTitleListElement {
    CustomTitle: CustomTitle[];
  }
  
  export interface CustomTitle {
    id: string[];
    Text: string[];
  }
  