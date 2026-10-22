exec(open(__file__.rsplit('/',1)[0]+'/comune.py').read())
import sys
SOGLIA=float(sys.argv[1]) if len(sys.argv)>1 else 60
# direzione locale ogni 10 m (segmento di 20 m centrato), poi svolte = variazioni nette su 40 m
st=np.arange(0.02,K-0.02,0.01)
h=np.array([brg(at(s-0.01),at(s+0.01)) for s in st])
dh=np.array([norm(h[i+1]-h[i]) for i in range(len(h)-1)])
# finestre di 4 passi (40 m): somma delle variazioni
sv=[]
i=0
while i < len(dh)-4:
    w=dh[i:i+4].sum()
    if abs(w)>=SOGLIA:
        # allarga finché la variazione cresce nello stesso verso
        j=i+4
        while j < len(dh) and np.sign(dh[j])==np.sign(w) and abs(dh[j])>4: w+=dh[j]; j+=1
        # centro = punto di massima variazione
        c=i+int(np.argmax(np.abs(dh[i:j])))
        sv.append(dict(km=round(float(st[c]),3), delta=round(float(w)), da=round(float(st[i]),3), a=round(float(st[j]),3)))
        i=j
    else: i+=1
print('svolte >=',SOGLIA,'gradi in 40 m:',len(sv))
# gruppi: coppie opposte entro 60 m = "destra poi subito sinistra"; serie >=3 entro 400 m = tornanti
out=[]
for s in sv:
    if out and s['km']-out[-1]['giri'][-1]['km']<=0.06 and np.sign(s['delta'])!=np.sign(out[-1]['giri'][-1]['delta']) and len(out[-1]['giri'])<2:
        out[-1]['giri'].append(s)
    else: out.append(dict(giri=[s]))
for o in out:
    o['km']=o['giri'][0]['km']
# tornanti: >=3 svolte ampie (>=100) alternate entro 400 m
for o in out:
    vicini=[q for q in out if abs(q['km']-o['km'])<=0.25 and abs(q['giri'][0]['delta'])>=100]
    o['tornanti']=len(vicini)>=3
sent=lambda k: next((t[2] for t in rt['trails'] if t[0]<=k<t[1]), rt['trails'][-1][2])
for o in out:
    g=' + '.join(f"{'dx' if s['delta']>0 else 'sx'} {abs(s['delta'])}°" for s in o['giri'])
    print(f"km {o['km']:6.2f} {sent(o['km']):3} {'TORNANTI ' if o['tornanti'] else ''}{g}")
json.dump(out,open(__file__.rsplit('/',1)[0]+'/svolte.json','w'))
