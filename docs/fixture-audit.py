import json,csv,re,subprocess,tempfile,hashlib
from pathlib import Path
from openpyxl import load_workbook
root=Path(__file__).resolve().parents[1]/'fixtures'
catalog=json.loads((root/'catalog.json').read_text()); report=[]
def rows(p):
 if p.suffix=='.xlsx':
  sheet=load_workbook(p,read_only=True,data_only=True).active;data=list(sheet.values);return [dict(zip(data[0],r)) for r in data[1:]]
 return list(csv.DictReader(p.open()))
def pdftext(p):
 text=subprocess.check_output(['pdftotext',str(p),'-'],text=True)
 if text.strip():return text
 with tempfile.TemporaryDirectory() as d:
  subprocess.run(['pdftoppm','-png','-r','150','-singlefile',str(p),d+'/page'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  return subprocess.check_output(['tesseract',d+'/page.png','stdout'],text=True,stderr=subprocess.DEVNULL)
for task in catalog:
 base=root/'tasks'/task['id']; inp=base/'inputs';ref=json.loads((base/'reference.json').read_text());checks=[]
 def check(name,actual,expected):checks.append({'check':name,'pass':actual==expected,'actual':actual,'reference':expected})
 check('catalog matches task card',task,json.loads((base/'task.json').read_text()))
 name=task['workflow_id'].split('/')[-1]
 if name=='volunteer_hours_reconciliation':
  sources=[rows(inp/'scheduler_export.csv')]
  if (inp/'self_reported.xlsx').exists():sources.append(rows(inp/'self_reported.xlsx'))
  scan=inp/'signins_scanned'/'shift_signins.pdf'
  if scan.exists():sources.append([{'person_id':p,'shift_id':s,'hours':h} for p,s,h in re.findall(r'(PERSON-[A-Z])\s+(SHIFT-[A-Z])\s+(\d+)',pdftext(scan))])
  pairs={}
  for si,source in enumerate(sources):
   for row in source:pairs.setdefault((row['person_id'],row['shift_id']),{}).setdefault(si,set()).add(float(row['hours']))
  accepted=0;conflicts=0
  for pair,vals in pairs.items():
   values=set().union(*vals.values())
   if len(values)>1:conflicts+=1
   elif len(vals)>=2:accepted+=next(iter(values))
  check('accepted hours from independent source reconciliation',accepted,ref['accepted_hours']);check('disagreement count',conflicts,ref['conflict_count']);check('unique shift count',len(pairs),ref['ordinary_shift_count'])
 elif name=='case_note_normalization':
  parsed=[]
  for file in sorted((inp/'notes_raw').glob('*.txt')):
   text=file.read_text();date=re.search(r'\b\d{4}-\d{2}-\d{2}\b',text).group();service=re.search(r'(?:Service(?: provided)?\s*:|service\s*=)\s*([^\n.|]+)',text).group(1).strip();outcomes=[x.strip() for x in re.findall(r'(?:Outcome(?: recorded)?\s*:|outcome\s*=)[ \t]*([^\n.]*)',text)];outcomes=[x for x in outcomes if x];exception=len(set(outcomes))!=1;parsed.append({'note_id':file.stem,'date':date,'service':service,'outcome':'' if exception else outcomes[0],'exception':exception})
  check('40 notes exact fields and exceptions',parsed,ref['records'])
 elif name=='board_report_synthesis':
  data=rows(inp/'financials.xlsx');expected=[[r['quarter'],r['category'],r['budget'],r['actual'],r['actual']-r['budget']] for r in data];check('all financial variances',expected,ref['variance_rows']);check('prior risk identities',[r['id'] for r in json.loads((inp/'prior_risks.json').read_text())],ref['risk_ids'])
 elif name=='grant_cycle_package':
  budget=rows(inp/'program_budget.xlsx');rules=json.loads((inp/'restriction_rules.json').read_text());check('budget sum',sum(r['amount'] for r in budget),ref['budget_total']);check('RFP requirements',re.findall(r'\b(R\d+):',pdftext(inp/'rfp.pdf')),ref['requirement_ids']);check('forbidden allocation count',sum(r['category'] in rules['unrestricted_only'] and r['fund']!='unrestricted' for r in budget),ref['forbidden_charges'])
 else:
  assets=json.loads((inp/'asset_inventory.json').read_text());check('asset IDs',[a['id'] for a in assets],ref['asset_ids']);check('unresolved asset count',sum(not a['proposed_owner'] or a['consent_status']!='documented' for a in assets),ref['unresolved_assets'])
 report.append({'id':task['id'],'checks':checks})
summary={'tasks':len(report),'checks':sum(len(t['checks']) for t in report),'failed':[{'id':t['id'],'check':c['check'],'actual':c['actual'],'reference':c['reference']} for t in report for c in t['checks'] if not c['pass']]}
print(json.dumps(summary,indent=2))
