"""홈택스 근로소득 간이세액표 엑셀(.xlsx)을 data/simple-tax-*.json 형식으로 바꾼다.

사용법:
    python3 -I tools/xlsx_to_json.py <간이세액표.xlsx> <시행일 YYYY-MM-DD> > data/simple-tax-YYYY-MM.json

openpyxl 이 필요하다 (pip install openpyxl).
시트 '근로소득간이세액표' 의 월급여액(천원) 이상·미만 행과 가족 1~11명 세액을 읽는다.
세액이 '-' 인 칸은 0, 월급여 10,000천원 행은 at10m 으로 따로 담는다.
"""
import json
import os
import sys

import openpyxl


def to_int(value):
    if value in (None, '-', ''):
        return 0
    return int(float(str(value).replace(',', '')))


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    path, effective = sys.argv[1], sys.argv[2]
    ws = openpyxl.load_workbook(path, data_only=True)['근로소득간이세액표']
    rows, at10m = [], None
    for r in ws.iter_rows(values_only=True):
        lo, hi = r[0], r[1]
        if isinstance(lo, (int, float)) and isinstance(hi, (int, float)):
            if len(r) < 13:
                sys.exit(f'가족 1~11명 열이 모자란 행이 있다: {r}')
            rows.append([int(lo) * 1000, int(hi) * 1000] + [to_int(v) for v in r[2:13]])
        elif str(lo).strip() == '10,000천원':
            at10m = [to_int(v) for v in r[2:13]]
    if not rows or at10m is None:
        sys.exit('표 행 또는 10,000천원 행을 찾지 못했다. 시트 구조가 바뀌었는지 확인한다.')
    out = {
        'source': f'홈택스 {os.path.basename(path)}',
        'effective': effective,
        'unit': '원',
        'columns': '[min,max,가족1..11]',
        'rows': rows,
        'at10m': at10m,
    }
    json.dump(out, sys.stdout, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
