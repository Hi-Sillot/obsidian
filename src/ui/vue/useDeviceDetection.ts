import { ref, onMounted, onUnmounted } from 'vue';

/**
 * 设备检测钩子，用于判断当前是否为移动设备
 */
export function useDeviceDetection() {
  const isMobile = ref(false);

  /**
   * 检测是否为移动设备
   */
  const checkIsMobile = () => {
    // 检测用户代理
    const userAgent = navigator.userAgent;
    const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    
    // 检测屏幕宽度
    const screenWidth = window.innerWidth;
    const isSmallScreen = screenWidth < 768;
    
    // 综合判断
    isMobile.value = mobileRegex.test(userAgent) || isSmallScreen;
  };

  onMounted(() => {
    checkIsMobile();
    // 监听窗口大小变化
    window.addEventListener('resize', checkIsMobile);
  });

  onUnmounted(() => {
    window.removeEventListener('resize', checkIsMobile);
  });

  return {
    isMobile
  };
}
