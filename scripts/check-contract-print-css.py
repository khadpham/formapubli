#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check CSS in hop dong: @page A4 margin 0, khong con rule cu gay cat mep / trang trang.
Chay: python3 scripts/check-contract-print-css.py [--css duong-dan-file-css-da-build]"""
import re, sys

def main():
    path = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == '--css' else 'src/app/globals.css'
    css = open(path, encoding='utf8').read()
    fails = []
    def ok(cond, msg):
        print(('DAT ' if cond else 'ROT ') + msg)
        if not cond: fails.append(msg)
    ok(re.search(r'@page\s*\{\s*size:\s*A4 portrait;\s*margin:\s*0;', css), '@page A4 margin 0')
    ok('margin: 20mm 15mm 20mm 30mm' not in css, 'khong con @page lech 20/15/20/30')
    ok('position: static !important' in css and '.fixed:has(#contract-print-area)' in css,
       'modal fixed duoc go ve static khi in')
    ok('#contract-print-area' in css and 'width: 794px !important' in css,
       'vung in rong 794px khop section docx')
    ok('page-break-after: always' in css, 'moi section docx sang trang moi')
    ok('position: absolute !important' not in css.split('@page')[0] or '#contract-print-area' not in css,
       'khong con position absolute cho vung in')
    # Component khong duoc dinh nghia @media print rieng nua (mot nguon duy nhat)
    comp = open('src/components/contracts/ContractPrintPreview.tsx', encoding='utf8').read()
    ok('@media print' not in comp, 'ContractPrintPreview khong con @media print rieng')
    sys.exit(1 if fails else 0)

main()
