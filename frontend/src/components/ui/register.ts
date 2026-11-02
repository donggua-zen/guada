/**
 * 插件 UI 原语全局注册
 *
 * 目的：插件产物是运行时加载的 IIFE，其模板里的 <GdXxx> 编译成
 * resolveComponent('GdXxx') 运行时解析——必须在这里显式全局注册，
 * 否则插件无法使用 Gd 原语组件。
 *
 * 原语契约：插件只依赖"组件名 + props + --gd-* token"，不感知内部实现。
 * 将来换 UI 方案（替换 ElementPlus 内部实现）只改这里 import 的组件内部，插件零改动。
 */
import { App } from "vue";
import GdButton from "./GdButton.vue";
import GdDialog from "./GdDialog.vue";
import GdTooltip from "./GdTooltip.vue";
import GdPopover from "./GdPopover.vue";
import GdPane from "./GdPane.vue";
import GdSplitpanes from "./GdSplitpanes.vue";
import GdInput from "./GdInput.vue";
import GdSwitch from "./GdSwitch.vue";
import GdSelect from "./GdSelect.vue";
import GdInputNumber from "./GdInputNumber.vue";
import GdSlider from "./GdSlider.vue";
import GdTag from "./GdTag.vue";
import GdAlert from "./GdAlert.vue";
import GdProgress from "./GdProgress.vue";
import GdDivider from "./GdDivider.vue";
import GdEmpty from "./GdEmpty.vue";
import GdCheckbox from "./GdCheckbox.vue";
import GdCheckboxGroup from "./GdCheckboxGroup.vue";
import GdSegmented from "./GdSegmented.vue";
import GdRadio from "./GdRadio.vue";
import GdRadioGroup from "./GdRadioGroup.vue";
import GdFormField from "./GdFormField.vue";
import GdTabs from "./GdTabs.vue";
import GdPagination from "./GdPagination.vue";
import GdCollapse from "./GdCollapse.vue";
import GdImageViewer from "./GdImageViewer.vue";
import GdDrawer from "./GdDrawer.vue";
import GdDatePicker from "./GdDatePicker.vue";
import GdTimePicker from "./GdTimePicker.vue";

export function registerUiPrimitives(app: App): void {
  app.component("GdButton", GdButton);
  app.component("GdDialog", GdDialog);
  app.component("GdTooltip", GdTooltip);
  app.component("GdPopover", GdPopover);
  app.component("GdPane", GdPane);
  app.component("GdSplitpanes", GdSplitpanes);
  app.component("GdInput", GdInput);
  app.component("GdSwitch", GdSwitch);
  app.component("GdSelect", GdSelect);
  app.component("GdInputNumber", GdInputNumber);
  app.component("GdSlider", GdSlider);
  app.component("GdTag", GdTag);
  app.component("GdAlert", GdAlert);
  app.component("GdProgress", GdProgress);
  app.component("GdDivider", GdDivider);
  app.component("GdEmpty", GdEmpty);
  app.component("GdCheckbox", GdCheckbox);
  app.component("GdCheckboxGroup", GdCheckboxGroup);
  app.component("GdSegmented", GdSegmented);
  app.component("GdRadio", GdRadio);
  app.component("GdRadioGroup", GdRadioGroup);
  app.component("GdFormField", GdFormField);
  app.component("GdTabs", GdTabs);
  app.component("GdPagination", GdPagination);
  app.component("GdCollapse", GdCollapse);
  app.component("GdImageViewer", GdImageViewer);
  app.component("GdDrawer", GdDrawer);
  app.component("GdDatePicker", GdDatePicker);
  app.component("GdTimePicker", GdTimePicker);
}