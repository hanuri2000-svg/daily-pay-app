from pathlib import Path
import re, json

p=Path('index.html')
s=p.read_text(encoding='utf-8')

s=s.replace('v5.6.4','v5.6.5').replace('5.6.4','5.6.5').replace('rabic-gongsu-pro-v5-6-4','rabic-gongsu-pro-v5-6-5')

old='function reportData(){var x=calculate();return {period:viewDate.getFullYear()+"년 "+(viewDate.getMonth()+1)+"월",company:x.company.name,rows:x.rows,units:x.units,labor:x.labor,deduction:x.deduction,expenses:x.expenses,final:x.final}}'
new='function reportData(){var x=calculate();return {period:viewDate.getFullYear()+"년 "+(viewDate.getMonth()+1)+"월",company:x.company.name,tax:Number(x.company.tax)||0,fixed:Number(x.company.fixed)||0,rows:x.rows,units:x.units,labor:x.labor,deduction:x.deduction,expenses:x.expenses,final:x.final}}'
if old not in s: raise SystemExit('reportData anchor not found')
s=s.replace(old,new,1)

s=s.replace('  badge(gx+gw-188,140,162,36,statusColor.bg,statusColor.fg,statusText,"bold 15px sans-serif");\n\n','',1)

old='metricCard(gx+(cardW+gap)*2,sY,cardW,topH,{title:"공제액",value:won(r.deduction),bg:"#fffaf4",border:"#f4e5c8",accent:"#efb24b",sub:r.deduction>0?"공제 적용 완료":"공제 없음"});'
new='metricCard(gx+(cardW+gap)*2,sY,cardW,topH,{title:"공제액",value:won(r.deduction),bg:"#fffaf4",border:"#f4e5c8",accent:"#efb24b",sub:"공제율 "+(Math.round((Number(r.tax)||0)*100)/100)+"%"+((Number(r.fixed)||0)>0?" · 고정공제 "+won(r.fixed):"")});'
if old not in s: raise SystemExit('deduction card anchor not found')
s=s.replace(old,new,1)

s=s.replace('title:"실수령",value:won(r.final)','title:"최종 정산액",value:won(r.final)',1)
s=s.replace('sub:statusText,subColor:"rgba(255,255,255,.82)"','sub:"노무비 - 공제 + 경비",subColor:"rgba(255,255,255,.82)"',1)

s=s.replace('var heroH=190, summaryH=248, calHeadH=42, cellH=94, paymentH=212, footerH=82;','var heroH=190, summaryH=248, calHeadH=42, cellH=94, paymentH=0, footerH=82;',1)
s=s.replace('var contentH=heroH+summaryH+calendarH+paymentH+expenseSectionHeight+footerH;','var contentH=heroH+summaryH+calendarH+expenseSectionHeight+footerH;',1)

start=s.find('  var payY=calY+calendarH+24;')
marker='  var expenseY=payY+paymentH+24;'
end=s.find(marker,start)
if start<0 or end<0: raise SystemExit('payment block anchor not found')
s=s[:start]+'  var expenseY=calY+calendarH+24;\n'+s[end+len(marker):]

s=s.replace('상대방이 보기 편한 정산서 이미지','월간 작업·정산 내역서',1)

p.write_text(s,encoding='utf-8')

Path('version.json').write_text(json.dumps({
  'version':'5.6.5',
  'message':'외부 공유용 정산서에서 미수금·입금상태 표기를 제거하고, 공제액에 공제율을 표시하도록 개선했습니다.'
},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

sw=Path('service-worker.js')
sw.write_text(sw.read_text(encoding='utf-8').replace('rabic-gongsu-pro-v5-6-4','rabic-gongsu-pro-v5-6-5'),encoding='utf-8')

# validation
html=p.read_text(encoding='utf-8')
assert 'v5.6.5' in html
assert '공제율 ' in html
assert 'title:"최종 정산액"' in html
assert 'var APP_VERSION="5.6.5"' in html
