exec(open(__file__.rsplit('/',1)[0]+'/comune.py').read())
cai=json.load(open(R+'assets/explorer/assets/sentieri.json'))['linee']
# km di gara del punto più vicino della traccia, separando i due passaggi del tratto comune
def proietta(ll, kmin=0, kmax=K):
    best=(1e9,0)
    for i in range(1,len(P)):
        if P[i][3]<kmin or P[i-1][3]>kmax: continue
        a,b=P[i-1],P[i]; k=math.cos(math.radians(ll[0]))
        A_=((a[1]-ll[1])*k*111320,(a[0]-ll[0])*110540); B_=((b[1]-ll[1])*k*111320,(b[0]-ll[0])*110540)
        vx,vy=B_[0]-A_[0],B_[1]-A_[1]; L2=vx*vx+vy*vy; t=max(0,min(1,-(A_[0]*vx+A_[1]*vy)/L2 if L2 else 0))
        d=math.hypot(A_[0]+t*vx,A_[1]+t*vy)
        if d<best[0]: best=(d,a[3]+t*(b[3]-a[3]))
    return best
eventi=[]
for li in cai:
    pts=[scena2ll(p[0],p[1]) for p in li['p']]
    # densifica a 5 m
    dd=[]
    for j in range(1,len(pts)):
        n_=max(1,int(dist(pts[j-1],pts[j])/5))
        for s in range(n_): f=s/n_; dd.append([pts[j-1][0]+f*(pts[j][0]-pts[j-1][0]), pts[j-1][1]+f*(pts[j][1]-pts[j-1][1])])
    dd.append(pts[-1])
    if len(dd)<2: continue
    D,I=tree.query(toM(np.array(dd)))
    stato=None; ultimoOn=None
    for j,(d,i) in enumerate(zip(D,I)):
        s = 'on' if d<12 else ('off' if d>35 else stato)
        if stato=='on' and s=='off': eventi.append((dd[ultimoOn], li['r'], dd[min(len(dd)-1,j)], 'lascia'))
        if stato=='off' and s=='on': eventi.append((dd[j], li['r'], dd[max(0,j-8)], 'entra'))
        if s=='on': ultimoOn=j
        if stato is None and s is not None: stato=s
        else: stato=s if s is not None else stato
    # estremità della linea vicino alla traccia che si allontana
    for e,o in ((0,min(8,len(dd)-1)),(len(dd)-1,max(0,len(dd)-9))):
        if D[e]<15 and D[o]>30: eventi.append((dd[e], li['r'], dd[o], 'capo'))
# per ogni evento: km (anche secondo passaggio nel tratto comune), lato del ramo rispetto al senso di gara
giunz=[]
for pt, refs, lontano, tipo in eventi:
    cand=[proietta(pt,0,K/2), proietta(pt,K/2,K)]
    for d,km in cand:
        if d>15: continue
        dirG=brg(at(km-0.01),at(km+0.02)); dirR=brg(pt,lontano)
        giunz.append(dict(km=round(km,3), refs=refs, lato=round(norm(dirR-dirG)), tipo=tipo))
giunz.sort(key=lambda g:g['km'])
# raggruppa entro 40 m
gr=[]
for g in giunz:
    if gr and g['km']-gr[-1]['km'][-1]<0.04: gr[-1]['km'].append(g['km']); gr[-1]['rami'].append((g['refs'],g['lato']))
    else: gr.append(dict(km=[g['km']], rami=[(g['refs'],g['lato'])]))
sent=lambda k: next((t[2] for t in rt['trails'] if t[0]<=k<t[1]), rt['trails'][-1][2])
print('DIRAMAZIONI DI SENTIERI CAI DALLA TRACCIA:', len(gr))
for g in gr:
    km=sum(g['km'])/len(g['km'])
    rami=sorted(set((','.join(r), (('dx' if l>20 else 'sx' if l<-20 else 'dritto')+('/indietro' if abs(l)>120 else ''))) for r,l in g['rami']))
    print(f"km {km:6.2f}  gara su {sent(km):3}  rami: {rami}")
json.dump([dict(km=round(sum(g['km'])/len(g['km']),3), rami=[dict(ref=','.join(r),lato=l) for r,l in g['rami']]) for g in gr], open(__file__.rsplit('/',1)[0]+'/diramazioni.json','w'), ensure_ascii=False, indent=1)
