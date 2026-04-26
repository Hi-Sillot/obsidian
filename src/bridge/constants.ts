/**
 * 插件级常量定义
 * 集中管理所有占位符、标记符等不可重复的常量
 */

/* ================================================================
   脚注占位符
   预处理阶段将 [^id] 替换为 @@VP_FN:id@@
   后处理阶段检测并替换为 <sup> 上标引用
   ================================================================ */
export const FN_PH_PREFIX = '@@VP_FN:';
export const FN_PH_SUFFIX = '@@';
export const FN_PH_DETECT = /@@VP_FN:(.+?)@@/g;

/* ================================================================
   注释（Annotation）占位符
   使用零宽字符包裹标签名
   ================================================================ */
export const ANNOTATION_PH_L = '\u200B\u200B\u200B';
export const ANNOTATION_PH_R = '\u200C\u200C\u200C';
export const ANNOTATION_PH_DETECT = /[\u200B]{3}([^\u200B\u200C]+)[\u200C]{3}/;
export const ANNOTATION_PH_SPLIT = /([\u200B]{3}[^\u200B\u200C]+[\u200C]{3})/g;
