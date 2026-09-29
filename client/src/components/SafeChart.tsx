import React, { useRef, useEffect } from 'react';
import * as echarts from 'echarts';
import { logger } from '@lark-apaas/client-toolkit/logger';

interface EChartProps {
  option: Record<string, unknown>;
  style?: React.CSSProperties;
  className?: string;
  theme?: string;
}

/**
 * Safe ECharts wrapper that avoids "Failed to execute 'removeChild' on 'Node'" errors.
 *
 * Root cause of the error: ECharts internally manipulates the canvas DOM node,
 * and when chart.dispose() runs during React unmount, the canvas removal can
 * race with React's own reconciliation, causing a removeChild mismatch.
 *
 * Fix strategy:
 * 1. Always wrap the chart div in a stable container div (same root structure on mount/unmount)
 * 2. Disconnect ResizeObserver BEFORE calling dispose
 * 3. Defer dispose to next microtask to ensure React's unmount commit completes first
 * 4. Guard all operations with disposedRef to prevent post-disposal calls
 */
const EChart: React.FC<EChartProps> = ({ option, style, className, theme }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const disposedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!chartRef.current || disposedRef.current) return;

    try {
      instanceRef.current = echarts.init(chartRef.current, theme, { renderer: 'canvas' });
      instanceRef.current.setOption(option, true);
      instanceRef.current.setOption({ tooltip: { show: false } });
    } catch (e) {
      logger.error('SafeChart init error', e);
      return;
    }

    const chart = instanceRef.current;
    const handleResize = (): void => {
      if (disposedRef.current) return;
      try {
        chart.resize();
      } catch (e) {
        logger.error('SafeChart resize error', e);
      }
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(chartRef.current);

    return () => {
      disposedRef.current = true;
      try {
        ro.disconnect();
      } catch (e) {
        logger.error('SafeChart ro disconnect error', e);
      }
      try {
        if (instanceRef.current) {
          const chartInstance = instanceRef.current;
          instanceRef.current = null;
          queueMicrotask(() => {
            try {
              chartInstance.dispose();
            } catch (e) {
              logger.error('SafeChart dispose error', e);
            }
          });
        }
      } catch (e) {
        logger.error('SafeChart cleanup error', e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    if (instanceRef.current && !disposedRef.current) {
      try {
        instanceRef.current.setOption(option, true);
        instanceRef.current.setOption({ tooltip: { show: false } });
      } catch (e) {
        logger.error('SafeChart setOption error', e);
      }
    }
  }, [option]);

  return (
    <div ref={containerRef} className={className} style={{ height: 300, ...style }}>
      <div ref={chartRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default EChart;
