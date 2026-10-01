"""Generate synthetic SDIF v3 / CL2 fixtures for the parser tests.

Run: python3 tests/gen_fixtures.py
"""
from pathlib import Path
OUT = Path(__file__).parent / "fixtures"

def put(line,start,val,just='l'):
    val=str(val); ln=len(val)
    return line[:start-1]+val+line[start-1+ln:]
def rec(code,fields):
    l=code+' '*158
    for s,ln,v,*j in fields:
        v=str(v); v=v.rjust(ln) if j else v.ljust(ln)
        l=l[:s-1]+v[:ln]+l[s-1+ln:]
    return l[:160]
def d0(name,uss,age,sex,dist,stroke,ev,date,prelim,pc,final,fc,pp,fp):
    return rec('D0',[(3,1,'1'),(12,28,name),(40,12,uss),(56,8,'00000000'),(64,2,age),(66,1,sex),(67,1,sex),(68,4,dist,1),(72,1,stroke),(73,4,ev,1),(77,4,'UNOV'),(81,8,date),(98,8,prelim,1),(106,1,pc),(116,8,final,1),(124,1,fc),(133,3,pp,1),(136,3,fp,1)])
def meet(name,date,team,rows):
    L=[rec('A0',[(12,2,'02'),(44,20,'Hy-Tek, Ltd')]),
       rec('B1',[(12,30,name),(86,20,'Vicenza'),(122,8,date),(130,8,date),(150,1,'Y')]),
       rec('C1',[(12,6,team),(18,30,'Test Aquatics')])]
    L+=rows+[rec('Z0',[])]
    return '\r\n'.join(L)+'\r\n'
a=meet('Fall Invite','10052025','ITTEST',[
 d0('Rossi, Marco A','A1','14','M','50','1','1','10052025','25.40','Y','24.98','Y','3','2'),
 rec('D3',[(3,14,'010111MARAROSS'),(17,15,'Marco')]),
 d0('Rossi, Marco A','A1','14','M','100','4','5','10052025','','', '1:01.22','Y','','4'),
 d0('Bianchi, Sofia','B1','13','F','50','1','2','10052025','','', 'DQ','X','',''),
 d0('Bianchi, Sofia','B1','13','F','200','5','8','10052025','','', '2:31.07','L','',''),
])
b=meet('Winter Champs','12122025','ITTEST',[
 d0('Rossi, Marco A','A1','14','M','50','1','3','12122025','','', '24.51','Y','','1'),
 rec('D3',[(3,14,'010111MARAROSS'),(17,15,'Marco')]),
 d0('Bianchi, Sofia','B1','13','F','50','1','4','12122025','','', '29.10','Y','','5'),
])
open(OUT/'fall-invite.cl2','w',newline='').write(a); open(OUT/'winter-champs.cl2','w',newline='').write(b)
