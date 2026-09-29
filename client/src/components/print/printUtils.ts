export function amountToChinese(num: number): string {
  if (num === 0) return '零元整';
  if (num < 0) return '负' + amountToChinese(Math.abs(num));

  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const units = ['', '拾', '佰', '仟'];
  const bigUnits = ['', '万', '亿', '兆'];

  const fixed = num.toFixed(2);
  const [intPart, decPart] = fixed.split('.');

  let result = '';

  const intNum = intPart;
  if (parseInt(intNum, 10) === 0) {
    result = '';
  } else {
    const groups: string[] = [];
    let remaining = intNum;
    while (remaining.length > 0) {
      groups.unshift(remaining.slice(-4));
      remaining = remaining.slice(0, -4);
    }

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi];
      let groupStr = '';
      let zeroFlag = false;
      for (let di = 0; di < group.length; di++) {
        const d = parseInt(group[di], 10);
        const pos = group.length - 1 - di;
        if (d === 0) {
          zeroFlag = true;
        } else {
          if (zeroFlag && groupStr) groupStr += '零';
          groupStr += digits[d] + units[pos];
          zeroFlag = false;
        }
      }
      if (groupStr) {
        result += groupStr + bigUnits[groups.length - 1 - gi];
      } else if (result && !result.endsWith('零')) {
        result += '零';
      }
    }
    result += '元';
  }

  const jiao = parseInt(decPart[0], 10);
  const fen = parseInt(decPart[1], 10);

  if (jiao === 0 && fen === 0) {
    result += '整';
  } else {
    if (jiao > 0) {
      result += digits[jiao] + '角';
    } else if (result && !result.endsWith('元')) {
      result += '零';
    }
    if (fen > 0) {
      result += digits[fen] + '分';
    }
  }

  return result || '零元整';
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.slice(0, 19).replace('T', ' ');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
