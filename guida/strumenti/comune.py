import json, math
R='/home/claude/skyracedelmaglio/'
tr=json.load(open(R+'posizione/traccia.json')); P=tr['pts']; K=tr['km_tot']
rt=json.load(open(R+'assets/explorer/assets/route.json'))
def at(km):
    km=max(0,min(K,km)); lo,hi=0,len(P)-1
    while hi-lo>1:
        m=(lo+hi)//2
        if P[m][3]<km: lo=m
        else: hi=m
    a,b=P[lo],P[hi]; f=(km-a[3])/(b[3]-a[3]) if b[3]>a[3] else 0
    return [a[i]+f*(b[i]-a[i]) for i in range(3)]
def brg(a,b):
    la1,la2=math.radians(a[0]),math.radians(b[0]); dl=math.radians(b[1]-a[1])
    y=math.sin(dl)*math.cos(la2); x=math.cos(la1)*math.sin(la2)-math.sin(la1)*math.cos(la2)*math.cos(dl)
    return (math.degrees(math.atan2(y,x))+360)%360
def dist(a,b):
    k=math.cos(math.radians(a[0])); return math.hypot((b[1]-a[1])*k*111320,(b[0]-a[0])*110540)
norm=lambda d:(d+540)%360-180
# affine fit scene x,y -> lat,lon using route.json points (km uniform)
import numpy as np
n=rt['n']; X=np.array(rt['x']); Y=np.array(rt['y']); kms=np.linspace(0,rt['total_km'],n)
LL=np.array([at(k)[:2] for k in kms])
A=np.c_[X,Y,np.ones(n)]
cl,_,_,_=np.linalg.lstsq(A,LL,rcond=None)
res=A@cl-LL; k=math.cos(math.radians(42.1))
err=np.hypot(res[:,1]*k*111320,res[:,0]*110540)
# affinamento ICP: abbina ogni punto della scena al punto più vicino della traccia GPS (densificata)
from scipy.spatial import cKDTree
dens=np.array([at(x)[:2] for x in np.arange(0,K,0.002)])
k0=math.cos(math.radians(42.1))
toM=lambda ll: np.c_[ll[:,1]*k0*111320, ll[:,0]*110540]
tree=cKDTree(toM(dens))
for it in range(15):
    pr=A@cl; d,i=tree.query(toM(pr)); cl,_,_,_=np.linalg.lstsq(A,dens[i],rcond=None)
pr=A@cl; d,i=tree.query(toM(pr)); errI=d
def scena2ll(x,y): v=np.array([x,y,1.0])@cl; return [float(v[0]),float(v[1])]
