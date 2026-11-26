#include "srm_guida.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cctype>
#include <cstring>

namespace srm
{

static const double K_PI = 3.14159265358979323846;
static inline double rad(double d) { return d * K_PI / 180; }
static inline double norm(double a) { return std::fmod(std::fmod(a, 360.0) + 540.0, 360.0) - 180.0; }
static inline double clampd(double v, double a, double b) { return std::max(a, std::min(b, v)); }
static inline double roundJs(double x) { return std::floor(x + 0.5); } // Math.round di JavaScript

double distanza(double la1d, double lo1, double la2d, double lo2)
{
    const double R = 6371000;
    double la1 = rad(la1d), la2 = rad(la2d), dla = la2 - la1, dlo = rad(lo2 - lo1);
    double h = std::pow(std::sin(dla / 2), 2) + std::cos(la1) * std::cos(la2) * std::pow(std::sin(dlo / 2), 2);
    return 2 * R * std::asin(std::sqrt(h));
}

double rotta(double la1d, double lo1, double la2d, double lo2)
{
    double la1 = rad(la1d), la2 = rad(la2d), dlo = rad(lo2 - lo1);
    double y = std::sin(dlo) * std::cos(la2);
    double x = std::cos(la1) * std::sin(la2) - std::sin(la1) * std::cos(la2) * std::cos(dlo);
    return std::fmod(std::atan2(y, x) * 180 / K_PI + 360, 360.0);
}

const char *cardinale(double b)
{
    static const char *P[] = {"nord", "nord-est", "est", "sud-est", "sud", "sud-ovest", "ovest", "nord-ovest"};
    return P[(int)roundJs(b / 45) % 8];
}

std::string kmParlati(double km)
{
    double x = roundJs(km * 10) / 10;
    char s[24];
    if (std::fabs(x - roundJs(x)) < 1e-9)
        snprintf(s, sizeof s, "%d", (int)roundJs(x));
    else {
        snprintf(s, sizeof s, "%.1f", x);
        for (char *c = s; *c; c++)
            if (*c == '.')
                *c = ',';
    }
    return s;
}

int metriParlati(double m)
{
    m = std::max(10.0, m);
    return m >= 100 ? (int)(roundJs(m / 50) * 50) : (int)(roundJs(m / 10) * 10);
}

// ---------- traccia ----------
void Traccia::at(double km, double out[3]) const
{
    km = std::max(0.0, std::min(kmTot, km));
    int lo = 0, hi = n - 1;
    while (hi - lo > 1) {
        int m = (lo + hi) >> 1;
        if (pts[m].km < km)
            lo = m;
        else
            hi = m;
    }
    const Punto &a = pts[lo], &b = pts[hi];
    double f = b.km > a.km ? (km - a.km) / (b.km - a.km) : 0;
    out[0] = a.lat + f * (b.lat - a.lat);
    out[1] = a.lon + f * (b.lon - a.lon);
    out[2] = a.ele + f * (b.ele - a.ele);
}

double Traccia::direzioneDopo(double km, double avanti) const
{
    double a[3], b[3];
    at(km - 0.015, a);
    at(km + avanti, b);
    return rotta(a[0], a[1], b[0], b[1]);
}

const char *Traccia::sentiero(double km) const
{
    for (int i = 0; i < nsent; i++)
        if (km >= sent[i].da && km < sent[i].a)
            return sent[i].nome;
    return nsent ? sent[nsent - 1].nome : "";
}

Traccia::Proiezione Traccia::proietta(double lat, double lon, double kmMin, double kmMax) const
{
    double k = std::cos(rad(lat));
    Proiezione best{INFINITY, 0};
    for (int i = 1; i < n; i++) {
        if (pts[i].km < kmMin || pts[i - 1].km > kmMax)
            continue;
        double Ax = (pts[i - 1].lon - lon) * k * 111320, Ay = (pts[i - 1].lat - lat) * 110540;
        double Bx = (pts[i].lon - lon) * k * 111320, By = (pts[i].lat - lat) * 110540;
        double vx = Bx - Ax, vy = By - Ay, L2 = vx * vx + vy * vy;
        double t = L2 ? -(Ax * vx + Ay * vy) / L2 : 0;
        t = std::max(0.0, std::min(1.0, t));
        double x = Ax + t * vx, y = Ay + t * vy, d = std::hypot(x, y);
        if (d < best.d)
            best = {d, pts[i - 1].km + t * (pts[i].km - pts[i - 1].km)};
    }
    return best;
}

// ---------- motore ----------
Motore::Motore(const Traccia &t, const Bivio *b, int nb, Opzioni op) : bivi(b), nBivi(nb), T(t), o(op) { reset(); }

void Motore::reset()
{
    kmOk = false;
    km = 0;
    tKm = 0;
    kmMax = 0;
    fuoriOk = false;
    storia.clear();
    buf.clear();
    flags.assign(nBivi, Flag());
    ultimaValidaOk = false;
    ultimaValida = 0;
    ultimoMovimento = 0;
    velocita = 0;
    dirOk = false;
    dir = 0;
    gpsAvvisato = false;
    indietro.n = 0;
    indietro.daOk = false;
    indietro.avvisato = false;
    silenzioIndietroFino = 0;
    arrivato = false;
    lontanoUltimo = 0;
    posOk = distOk = false;
    dist = 0;
    attesaOk = false;
    attesa = 0;
    attesaDetta = false;
    ultimoParlatoOk = false;
    ultimoParlato = 0;
}

double Motore::corridoio(double acc) const
{
    double c = clampd(std::max(o.corridoioMin, 2 * acc), o.corridoioMin, o.corridoioMax);
    if (kmOk)
        for (int i = 0; i < nBivi; i++) {
            const Bivio &b = bivi[i];
            if (km >= b.km - 0.05 && km <= b.km + b.verificaM / 1000 + 0.05) {
                c = clampd(1.5 * acc, o.corridoioBivio[0], o.corridoioBivio[1]);
                break;
            }
        }
    return c;
}

void Motore::movimento(const Fix &f)
{
    storia.push_back(f);
    while (!storia.empty() && f.t - storia.front().t > 40000)
        storia.erase(storia.begin());
    const Fix *ref = nullptr;
    for (int i = (int)storia.size() - 2; i >= 0; i--) {
        if (distanza(storia[i].lat, storia[i].lon, f.lat, f.lon) >= 20) {
            ref = &storia[i];
            break;
        }
    }
    const Fix &old = storia.front();
    double dt = (f.t - old.t) / 1000.0;
    if (dt >= 5)
        velocita = distanza(old.lat, old.lon, f.lat, f.lon) / dt;
    if (ref) {
        dir = rotta(ref->lat, ref->lon, f.lat, f.lon);
        dirOk = true;
    } else if (velocita < 0.3)
        dirOk = false;
    if (velocita > 0.6)
        ultimoMovimento = f.t;
}

std::string Motore::lato(const Fix &f, const double q[3]) const
{
    double b = rotta(f.lat, f.lon, q[0], q[1]);
    if (!dirOk)
        return std::string("verso ") + cardinale(b);
    double r = norm(b - dir);
    if (std::fabs(r) <= 25)
        return "davanti a te";
    if (std::fabs(r) >= 155)
        return "alle tue spalle";
    return r > 0 ? "alla tua destra" : "alla tua sinistra";
}

std::vector<Evento> Motore::tick(int64_t t)
{
    std::vector<Evento> ev;
    if (kmOk && !arrivato && ultimaValidaOk && !gpsAvvisato && t - ultimaValida > o.gpsDebole &&
        ultimoMovimento > ultimaValida - 30000) {
        gpsAvvisato = true;
        ev.push_back({"gps", INFO, "attenzione", "", "Segnale GPS debole. Avviso di fuori percorso sospeso."});
    }
    int64_t r = o.rassicura;
    int64_t up = ultimoParlatoOk ? ultimoParlato : t;
    if (r > 0 && kmOk && !arrivato && !fuoriOk && !gpsAvvisato && t - up >= r && t - ultimoMovimento < 20000 &&
        t - (ultimaValidaOk ? ultimaValida : 0) < 10000) {
        Prossimo p = prossimoBivio();
        if (!p.b || p.d > 300) {
            std::string testo = "Sei sul percorso, chilometro " + kmParlati(km) + ".";
            if (p.b)
                testo += " Prossimo bivio fra " +
                         (p.d >= 1000 ? kmParlati(p.d / 1000) + " chilometri" : std::to_string(metriParlati(p.d)) + " metri") + ".";
            else
                testo += " Arrivo fra " + kmParlati(std::max(0.0, T.kmTot - km)) + " chilometri.";
            ev.push_back({"conferma", INFO, "", "", testo});
        }
        ultimoParlato = t;
        ultimoParlatoOk = true;
    }
    if (!ev.empty()) {
        ultimoParlato = t;
        ultimoParlatoOk = true;
    }
    return ev;
}

std::vector<Evento> Motore::posizione(const Fix &f)
{
    std::vector<Evento> ev = _posizione(f);
    bool parla = false;
    for (auto &e : ev)
        if (!e.testo.empty())
            parla = true;
    if (parla) {
        ultimoParlato = f.t;
        ultimoParlatoOk = true;
    } else if (!ultimoParlatoOk && kmOk) {
        ultimoParlato = f.t;
        ultimoParlatoOk = true;
    }
    return ev;
}

std::vector<Evento> Motore::_posizione(Fix fix)
{
    std::vector<Evento> ev;
    if (arrivato)
        return ev;
    if (!(fix.acc <= o.precisioneMax))
        return ev;
    if (gpsAvvisato) {
        gpsAvvisato = false;
        ev.push_back({"gps-ok", INFO, "", "", "Segnale GPS tornato."});
    }
    ultimaValida = fix.t;
    ultimaValidaOk = true;
    buf.push_back(fix);
    while (!buf.empty() && (fix.t - buf.front().t > 3500 || buf.size() > 4))
        buf.erase(buf.begin());
    const double accGrezza = fix.acc;
    double sla = 0, slo = 0;
    for (auto &q : buf) {
        sla += q.lat;
        slo += q.lon;
    }
    fix.lat = sla / buf.size();
    fix.lon = slo / buf.size();
    movimento(fix);
    const double corr = corridoio(accGrezza);

    if (!kmOk) {
        Traccia::Proiezione a = T.proietta(fix.lat, fix.lon, 0, T.kmTot / 2), b = T.proietta(fix.lat, fix.lon, T.kmTot / 2, T.kmTot);
        Traccia::Proiezione p = a.d <= b.d + 30 ? a : b;
        if (a.d <= corr && b.d <= corr && std::fabs(a.km - b.km) > 1) {
            auto concorde = [&](const Traccia::Proiezione &q) {
                return dirOk && std::fabs(norm(dir - T.direzioneDopo(q.km, 0.03))) < 90;
            };
            if (!dirOk) {
                if (!attesaOk) {
                    attesa = fix.t;
                    attesaOk = true;
                }
                if (fix.t - attesa < o.attesaDirezione) {
                    pos = fix;
                    posOk = true;
                    dist = std::min(a.d, b.d);
                    distOk = true;
                    if (!attesaDetta) {
                        attesaDetta = true;
                        ev.push_back({"attesa", INFO, "", "", "Sei sul percorso. Inizia a muoverti e capisco in che senso vai."});
                    }
                    return ev;
                }
            } else
                p = concorde(b) && !concorde(a) ? b : a;
        }
        pos = fix;
        posOk = true;
        dist = p.d;
        distOk = true;
        if (p.d > corr) {
            if (fix.t - lontanoUltimo > 60000) {
                lontanoUltimo = fix.t;
                double q[3];
                T.at(p.km, q);
                std::string d = p.d >= 1000 ? kmParlati(p.d / 1000) + " chilometri" : std::to_string(metriParlati(p.d)) + " metri";
                ev.push_back({"lontano", INFO, "", "", "Raggiungi il percorso: è a " + d + ", " + lato(fix, q) + ". Segui sentieri e strade."});
            }
            return ev;
        }
        km = p.km;
        kmOk = true;
        tKm = fix.t;
        kmMax = p.km;
        ev.push_back({"aggancio", INFO, "positivo", "", "Sei sul percorso, al chilometro " + kmParlati(p.km) + "."});
        controllaBivi(ev, fix, true);
        return ev;
    }

    Traccia::Proiezione p = T.proietta(fix.lat, fix.lon, km - 0.2, km + 1.5);
    double dt = (fix.t - tKm) / 1000.0;
    if (p.km - km > (dt * o.velMax + 40) / 1000)
        return ev; // salto impossibile: errore del GPS
    pos = fix;
    posOk = true;
    dist = p.d;
    distOk = true;

    bool dentro = fuoriOk && fuori.annunciato ? p.d <= corr * 0.75 : p.d <= corr;
    if (dentro) {
        if (fuoriOk) {
            if (fuori.annunciato)
                ev.push_back({"rientro", ERRORE, "positivo", "", "Di nuovo sul percorso."});
            fuoriOk = false;
        }
        controllaVerso(ev, fix, p);
        if (p.km >= km - 0.2) {
            km = p.km;
            tKm = fix.t;
            kmMax = std::max(kmMax, p.km);
        }
        controllaBivi(ev, fix, false, p.d <= std::max(12.0, 0.6 * corr));
        if (km >= T.kmTot - 0.03 && kmMax >= T.kmTot - 0.03) {
            arrivato = true;
            ev.push_back({"arrivo", BIVIO, "positivo", "", "Arrivo. Complimenti, gara finita!"});
        }
        return ev;
    }

    if (!fuoriOk) {
        fuoriOk = true;
        fuori.n = 0;
        fuori.primo[0] = fix.lat;
        fuori.primo[1] = fix.lon;
        fuori.annunciato = false;
        fuori.ultimo = 0;
        fuori.bivio = bivioRecente();
    }
    Fuori &f = fuori;
    f.n++;
    double fatti = distanza(f.primo[0], f.primo[1], fix.lat, fix.lon);
    int sogliaN = f.bivio ? o.sbagliatoFix : o.fuoriFix;
    double sogliaM = f.bivio ? o.sbagliatoMetri : o.fuoriMetri;
    bool confermato = f.n >= sogliaN && (fatti >= sogliaM || p.d > corr * 1.5);
    if (!confermato)
        return ev;
    if (f.annunciato && fix.t - f.ultimo < o.ripetiFuori)
        return ev;

    std::string ancora = f.annunciato ? "Ancora fuori. " : "";
    if (f.bivio) {
        int nm = metriParlati(distanza(fix.lat, fix.lon, f.bivio->lat, f.bivio->lon));
        flag(f.bivio).sbagliato = true;
        ev.push_back({"sbagliato", ERRORE, "allarme", f.bivio->id,
                      f.annunciato ? "Torna indietro, " + std::to_string(nm) + " metri."
                                   : "Sentiero sbagliato! Torna indietro, " + std::to_string(nm) + " metri."});
    } else {
        Traccia::Proiezione vicino = T.proietta(fix.lat, fix.lon, km - 0.3, km + 1.5);
        double q[3];
        T.at(vicino.km, q);
        std::string lt = lato(fix, q);
        std::string quanto =
            vicino.d >= 1000 ? kmParlati(vicino.d / 1000) + " chilometri" : std::to_string(metriParlati(vicino.d)) + " metri";
        std::string testo = (f.annunciato ? ancora : std::string("Fuori percorso! ")) + "Percorso a " + quanto + ", " + lt + ".";
        if (vicino.d > 300)
            testo += " Torna sui tuoi passi.";
        ev.push_back({"fuori", ERRORE, "allarme", "", testo});
    }
    f.annunciato = true;
    f.ultimo = fix.t;
    return ev;
}

const Bivio *Motore::bivioRecente()
{
    for (int i = 0; i < nBivi; i++) {
        const Bivio *b = &bivi[i];
        const Flag &f = flag(b);
        if (!b->silenzioso && (f.ind || f.pre) && !f.ver && b->km >= km - 0.25 && b->km <= km + 0.05)
            return b;
    }
    return nullptr;
}

void Motore::controllaVerso(std::vector<Evento> &ev, const Fix &f, const Traccia::Proiezione &p)
{
    if (!dirOk || velocita < 0.6)
        return;
    double dirTraccia = T.direzioneDopo(p.km, 0.03);
    if (std::fabs(norm(dir - dirTraccia)) > 135) {
        if (!indietro.daOk) {
            indietro.da[0] = f.lat;
            indietro.da[1] = f.lon;
            indietro.daOk = true;
        }
        indietro.n++;
        if (!indietro.avvisato && indietro.n >= o.indietroFix &&
            distanza(indietro.da[0], indietro.da[1], f.lat, f.lon) >= o.indietroMetri && f.t > silenzioIndietroFino) {
            indietro.avvisato = true;
            ev.push_back({"indietro", ERRORE, "allarme", "",
                          "Stai andando al contrario. Se vuoi tornare indietro, tocca «Torna indietro». Altrimenti girati."});
        }
    } else if (indietro.n) {
        indietro.n = 0;
        indietro.daOk = false;
        indietro.avvisato = false;
    }
}

void Motore::controllaBivi(std::vector<Evento> &ev, const Fix &fix, bool primoAggancio, bool benCentrato)
{
    (void)fix;
    double v = std::max(velocita, 1.5);
    for (int i = 0; i < nBivi; i++) {
        const Bivio *b = &bivi[i];
        if (b->km < km - 0.4 || b->km > km + 1)
            continue;
        Flag &f = flag(b);
        double D = (b->km - km) * 1000;
        if (primoAggancio && D < 0) {
            f.pre = f.ind = f.ora = f.ver = true;
            continue;
        }
        bool sentiero = std::strcmp(b->tipo, "sentiero") == 0;
        double dInd = sentiero ? 10 : std::max(o.indicazione, v * 12);
        auto primaAltro = [&]() {
            for (int j = 0; j < nBivi; j++) {
                const Bivio *x = &bivi[j];
                if (x != b && !x->silenzioso && x->km > km && x->km < b->km && !flag(x).ind)
                    return true;
            }
            return false;
        };
        if (!f.pre && b->preResto && D <= std::max(o.preavviso, v * 60) && D > dInd + 30 && !primaAltro()) {
            f.pre = true;
            ev.push_back({"preavviso", BIVIO, "attenzione", b->id, "Fra " + std::to_string(metriParlati(D)) + " metri, " + b->preResto});
        }
        if (!f.ind && D <= dInd && D > -15) {
            f.ind = f.pre = true;
            ev.push_back({"indicazione", BIVIO, "attenzione", b->id, b->ind});
        }
        if (!f.ora && b->ora && f.ind && D <= o.adesso && D > -10) {
            f.ora = true;
            ev.push_back({"ora", BIVIO, "", b->id, b->ora});
        }
        if (!f.ver && (b->silenzioso || std::strcmp(b->tipo, "svolta") == 0) && D <= -b->verificaM) {
            f.ver = f.pre = f.ind = f.ora = true;
            continue;
        }
        if (!f.ver && D <= -b->verificaM && benCentrato) {
            f.ver = f.pre = f.ind = f.ora = true;
            ev.push_back({"giusto", INFO, "positivo", b->id, f.sbagliato ? "Bene, ora sei sul percorso." : b->giusto});
        }
    }
}

void Motore::aggancia(double k, int64_t t)
{
    km = k;
    kmOk = true;
    tKm = t;
    kmMax = k;
    for (int i = 0; i < nBivi; i++)
        if (bivi[i].km < k - 0.02) {
            Flag &f = flags[i];
            f.pre = f.ind = f.ora = f.ver = true;
        }
}

Prossimo Motore::prossimoBivio() const
{
    Prossimo r;
    if (!kmOk)
        return r;
    for (int i = 0; i < nBivi; i++) {
        const Bivio *b = &bivi[i];
        if (!b->silenzioso && !flag(b).ver && b->km >= km - 0.02) {
            r.b = b;
            r.d = std::max(0.0, (b->km - km) * 1000);
            return r;
        }
    }
    return r;
}

Stato Motore::stato() const
{
    Stato s;
    s.agganciato = kmOk;
    s.km = km;
    s.dist = dist;
    s.fuori = fuoriOk && fuori.annunciato;
    s.sbagliato = fuoriOk && fuori.annunciato && fuori.bivio;
    s.arrivato = arrivato;
    s.velocita = velocita;
    s.haDirezione = dirOk;
    s.direzione = dir;
    s.prossimo = prossimoBivio();
    s.sentiero = kmOk ? T.sentiero(km) : "";
    return s;
}

std::string Motore::doveSono() const
{
    if (!kmOk)
        return "Non sei ancora sul percorso.";
    std::string s = "Sei al chilometro " + kmParlati(km);
    const char *sent = T.sentiero(km);
    if (sent && *sent)
        s += std::string(", sul sentiero ") + sent;
    s += ". Mancano " + kmParlati(std::max(0.0, T.kmTot - km)) + " chilometri all'arrivo.";
    Prossimo p = prossimoBivio();
    if (p.b) {
        std::string t = p.b->titolo;
        for (auto &c : t)
            c = (char)std::tolower((unsigned char)c);
        s += " Prossimo bivio tra " +
             (p.d >= 1000 ? kmParlati(p.d / 1000) + " chilometri" : std::to_string(metriParlati(p.d)) + " metri") + ": " + t + ".";
    }
    return s;
}

} // namespace srm
