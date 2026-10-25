/**
 * 控制栏自动隐藏策略（ArtPlayer.CONTROL_HIDE_TIME，全局 static）。
 *
 * 该值是共享状态：恢复时一律回到**库默认值**而不是「进入时的快照」——
 * 点播 / 直播两个播放器先后挂载时，快照可能已经是被上一个组件改过的值
 * （例如另一实例暂时停用库计时），互相污染会使下一实例不再收起。
 * 本应用是唯一写入方，库默认值即安全基准。
 */
export const ART_DEFAULT_CONTROL_HIDE_MS = 3000;
/** 桌面：鼠标停止移动 / 离开播放器后快速收起 */
export const DESKTOP_CONTROL_HIDE_MS = 800;
/** 触屏：播放中无操作三秒后隐藏，暂停 / 拖动 / 菜单由共用控制器保护。 */
export const TOUCH_CONTROL_HIDE_MS = 3000;
