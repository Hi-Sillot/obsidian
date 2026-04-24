import * as echarts from 'echarts';
import { Chart as ChartJS } from 'chart.js/auto';
import { parse as parseFlowchart } from 'flowchart.ts';
import { Transformer } from 'markmap-lib';
import { Markmap, globalCSS } from 'markmap-view';

const globalObj: any = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this);

globalObj.SillotExt = {
	echarts,
	ChartJS,
	parseFlowchart,
	Transformer,
	Markmap,
	globalCSS,
};
