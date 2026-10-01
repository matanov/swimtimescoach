"""Generate synthetic SDIF v3 / CL2 fixtures for the parser tests.

Run: python3 tests/gen_fixtures.py
"""
from pathlib import Path
OUT = Path(__file__).parent / "fixtures"

def rec(code,fields):
    l=code+' '*158
    for s,ln,v,*j in fields:
        v=str(v); v=v.rjust(ln) if j else v.ljust(ln)
        l=l[:s-1]+v[:ln]+l[s-1+ln:]
    return l[:160]
def d0(name,uss,age,sex,dist,stroke,ev,date,prelim,pc,final,fc,pp,fp,swimoff='',sc=''):
    return rec('D0',[(3,1,'1'),(12,28,name),(40,12,uss),(56,8,'00000000'),(64,2,age),(66,1,sex),(67,1,sex),(68,4,dist,1),(72,1,stroke),(73,4,ev,1),(77,4,'UNOV'),(81,8,date),(98,8,prelim,1),(106,1,pc),(107,8,swimoff,1),(115,1,sc),(116,8,final,1),(124,1,fc),(133,3,pp,1),(136,3,fp,1)])
def meet(name,date,team,rows,course='Y'):
    L=[rec('A0',[(12,2,'02'),(44,20,'Hy-Tek, Ltd')]),
       rec('B1',[(12,30,name),(86,20,'Vicenza'),(122,8,date),(130,8,date),(150,1,course)]),
       rec('C1',[(12,6,team),(18,30,'Test Aquatics')])]
    L+=rows+[rec('Z0',[])]
    return '\r\n'.join(L)+'\r\n'
a=meet('Fall Invite','10052025','ITTEST',[
 d0('Rossi, Marco A','A1','14','M','50','1','1','10052025','25.40','Y','24.98','Y','3','2'),
 rec('D3',[(3,14,'010111MARAROSS'),(17,15,'Marco')]),
 d0('Rossi, Marco A','A1','14','M','100','4','5','10052025','','', '1:01.22','Y','','4'),
 d0('Bianchi, Sofia','B1','13','F','50','1','2','10052025','','', 'DQ','X','',''),
 d0('Bianchi, Sofia','B1','13','F','200','5','8','10052025','2:33.40','L','2:31.07','L','',''  ,'2:32.95','L'),
 # relay-only entry: no distance/stroke, but its D3 still names the swimmer
 d0('Verdi, Luca','C1','15','M','','','','10052025','','','','','',''),
 rec('D3',[(3,14,'020111LUCAVERD'),(17,15,'Luke')]),
])
b=meet('Winter Champs','12122025','ITTEST',[
 d0('Rossi, Marco A','A1','14','M','50','1','3','12122025','','', '24.51','Y','','1'),
 rec('D3',[(3,14,'010111MARAROSS'),(17,15,'Marco')]),
 d0('Bianchi, Sofia','B1','13','F','50','1','4','12122025','','', '29.10','Y','','5'),
 d0('Rossi, Marco A','A1','14','M','500','1','9','12122025','','', '4:52.10','Y','','2'),
])
# same meet name as `a`, a year earlier: must stay a separate meet
c=meet('Fall Invite','10062024','ITTEST',[
 d0('Rossi, Marco A','A1','13','M','50','1','1','10062024','','', '26.10','Y','','4'),
])
# long course meet; one swim timed short course meters (per-time course code)
d=meet('Summer LC','07152025','ITTEST',[
 d0('Rossi, Marco A','A1','14','M','50','1','1','07152025','','', '27.80','L','','3'),
 d0('Rossi, Marco A','A1','14','M','400','1','2','07152025','','', '4:31.00','L','','1'),
 d0('Rossi, Marco A','A1','14','M','50','1','3','07162025','','', '26.40','S','','2'),
],course='L')
for fn,txt in [('fall-invite.cl2',a),('winter-champs.cl2',b),('fall-invite-2024.cl2',c),('summer-lc.cl2',d)]:
    open(OUT/fn,'w',newline='').write(txt)
