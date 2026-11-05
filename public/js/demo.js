/* 示例策划案 —— 首次打开时展示，可在「说明 → 载入示例」恢复 */

export function demoPlan() {
  const shot = (o) => Object.assign({
    id: 'sh_' + Math.random().toString(36).slice(2, 8),
    url: '', thumb: '', title: '',
    props: [], shotSize: '', direction: '', angle: '', focal: '',
    composition: [], light: '', expression: '', action: '', note: '',
  }, o);

  return {
    id: 'p_demo',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    theme: '雨落三点半',
    concept: '把一场没有目的的午后写成三段时间：雨声、咖啡凉掉的速度，以及光从窗沿退到桌角的过程。不追求情绪外露，用克制的肢体和大量留白，让人物成为空间的一部分。',
    costume: ['米色长风衣', '白衬衫', '深棕针织衫', '黑色乐福鞋'],
    style: ['日系胶片质感', '低饱和暖调', '自然光为主', '轻微颗粒'],
    props: ['陶瓷咖啡杯', '胶片相机', '透明长柄伞', '旧书', '格纹毛毯'],
    time: '11 月 8 日（周六）14:30–17:00 · 阴雨',
    location: '老城区二层咖啡馆 · 靠窗卡座（北向窗，全天柔光）',
    shots: [
      shot({
        url: '/demo/01.jpg', props: ['陶瓷咖啡杯'], shotSize: '中景', direction: '斜侧面', angle: '平拍', focal: '中焦',
        composition: ['三分线'], light: '柔光',
        expression: '不笑，眼神落在雨里但不聚焦',
        action: '侧坐，双手环杯，让窗框的竖线压住画面右侧',
      }),
      shot({
        url: '/demo/05.jpg', props: ['陶瓷咖啡杯'], shotSize: '特写', direction: '正面', angle: '平拍', focal: '长焦',
        composition: ['留白'], light: '顺光',
        expression: '空镜：让热气替人物说话',
        action: '等热气升到镜头前再按，杯口留一点唇印',
      }),
      shot({
        url: '/demo/07.jpg', props: ['旧书', '陶瓷咖啡杯'], shotSize: '近景', direction: '侧面', angle: '平拍', focal: '中焦',
        composition: ['框架'], light: '正侧光',
        expression: '专注，眉心微收',
        action: '翻页时停住，指尖夹在书页之间，不要抬头',
      }),
      shot({
        url: '/demo/04.jpg', props: ['陶瓷咖啡杯'], shotSize: '特写', direction: '斜侧面', angle: '平拍', focal: '中焦',
        composition: ['居中'], light: '侧逆光',
        expression: '—',
        action: '双手捧杯停顿三秒，让蒸汽在逆光里显形',
      }),
      shot({
        url: '/demo/08.jpg', props: ['陶瓷咖啡杯'], shotSize: '远景', direction: '正面', angle: '俯拍', focal: '广角',
        composition: ['对称'], light: '柔光',
        expression: '—',
        action: '上二楼俯拍，等人坐满再拍，人物放在桌阵的接缝处',
      }),
      shot({
        url: '/demo/06.jpg', props: ['旧书'], shotSize: '全景', direction: '背面', angle: '平拍', focal: '广角',
        composition: ['引导线'], light: '逆光',
        expression: '看不见表情，用肩颈的松紧说话',
        action: '走进书架之间，走到第三排停半秒再回头',
      }),
      shot({
        url: '/demo/11.jpg', props: ['透明长柄伞'], shotSize: '特写', direction: '正面', angle: '仰拍', focal: '长焦',
        composition: ['前景'], light: '侧逆光',
        expression: '—',
        action: '伞面压低，用水珠当前景，等一串水珠连成线',
      }),
    ],
  };
}
