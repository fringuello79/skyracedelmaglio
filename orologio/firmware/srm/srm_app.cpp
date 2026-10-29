#include "srm_app.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace srm
{

static const double K_PI = 3.14159265358979323846;
static inline double rad(double d) { return d * K_PI / 180; }
static inline double norm(double a) { return std::fmod(std::fmod(a, 360.0) + 540.0, 360.0) - 180.0; }

App::App(const Traccia &t, const Bivio *bivi, int nBivi, int pett, Opzioni o)
    : motore(t, bivi, nBivi, [&] {
          o.rassicura = 600000; // sull'orologio «Sei sul percorso» ogni 10 minuti di silenzio
          return o;
      }()),
      pettorale(pett), T(t)
{
    double a = 90, b = -90, c = 180, d = -180;
    for (int i = 0; i < t.n; i++) {
        a = std::min(a, t.pts[i].lat), b = std::max(b, t.pts[i].lat);
        c = std::min(c, t.pts[i].lon), d = std::max(d, t.pts[i].lon);
    }
    centro[0] = (a + b) / 2;
    centro[1] = (c + d) / 2;
}

Azioni App::prendiAzioni()
{
    Azioni a = std::move(az);
    az = Azioni();
    return a;
}

void App::sveglia(int64_t ms)
{
    az.sveglia = true;
    accesoFino = std::max(accesoFino, oraMs + ms);
}

static int priorita(Vibra v)
{
    switch (v) {
    case Vibra::SOS:
        return 6;
    case Vibra::ERRORE:
        return 5;
    case Vibra::ORA:
        return 4;
    case Vibra::INDICAZIONE:
        return 3;
    case Vibra::PREAVVISO:
        return 2;
    case Vibra::TOCCO:
        return 1;
    default:
        return 0;
    }
}

void App::evento(const Evento &e)
{
    const std::string &k = e.tipo;
    bool errore = k == "fuori" || k == "sbagliato" || k == "indietro";
    Vibra v = errore                ? Vibra::ERRORE
              : k == "preavviso"    ? Vibra::PREAVVISO
              : k == "indicazione"  ? Vibra::INDICAZIONE
              : k == "ora"          ? Vibra::ORA
              : k == "giusto"       ? Vibra::TOCCO
              : k == "conferma"     ? Vibra::TOCCO
              : k == "sos" || k == "sos-ok" ? Vibra::SOS
                                    : Vibra::NESSUNA;
    if (priorita(v) > priorita(az.vibra))
        az.vibra = v;
    Suono so = e.suono == "allarme" ? Suono::ERRORE : e.suono == "attenzione" ? (k == "preavviso" ? Suono::PREAVVISO : Suono::BIVIO)
             : e.suono == "positivo" ? Suono::POSITIVO
                                     : Suono::NESSUNO;
    if (k == "sos" || k == "sos-ok")
        so = Suono::SOS;
    if (so != Suono::NESSUNO)
        az.suono = so;
    bool svegliaSi = errore || k == "preavviso" || k == "indicazione" || k == "ora" || k == "gps" || k == "arrivo" || k == "sos" ||
                     k == "sos-ok";
    if (svegliaSi) {
        sveglia(k == "fuori" ? 20000 : k == "sos-ok" ? 60000 : 9000);
        if (k != "sos" && k != "sos-ok")
            pagina = Pagina::GUIDA;
        else
            pagina = Pagina::SOS;
    }
    std::string testo = e.testo;
    // sull'orologio non c'è il comando «Torna indietro» del telefono
    if (k == "indietro")
        testo = "Stai andando al contrario. Girati.";
    if (!testo.empty()) {
        sottotitolo = testo;
        sottotitoloFino = oraMs + 7000;
        az.diario.push_back(testo);
        az.voce = k + (e.bivio.empty() ? "" : ":" + e.bivio);
    }
    ultimoTipo = k;
    ultimoT = oraMs;
}

void App::dalMotore(const std::vector<Evento> &ev)
{
    for (auto &e : ev)
        evento(e);
}

void App::invia(const char *tipo, bool conRif, bool conPos)
{
    char b[96];
    int n = snprintf(b, sizeof b, "SRM %s P%03d", tipo, pettorale);
    if (conRif)
        n += snprintf(b + n, sizeof b - n, " R%d", rifSos);
    Stato st = motore.stato();
    if (st.agganciato)
        n += snprintf(b + n, sizeof b - n, " km%.1f", st.km);
    if (conPos && haFix)
        n += snprintf(b + n, sizeof b - n, " %.5f,%.5f", fix.lat, fix.lon);
    az.messaggi.push_back(b);
}

void App::secondo(const Fix *f, int64_t ora, int32_t oraLocale, int batteria)
{
    oraMs = ora;
    oraLoc = oraLocale;
    batt = batteria;
    if (f) {
        fix = *f;
        haFix = true;
        tFix = ora;
        dalMotore(motore.posizione(*f));
    }
    dalMotore(motore.tick(ora));
    Stato st = motore.stato();
    // fuori percorso: lo sa anche la base, una volta per episodio
    if (st.fuori && !statoInviato) {
        statoInviato = true;
        invia(st.sbagliato ? "SBAGLIATO" : "FUORI", false, true);
    } else if (!st.fuori && statoInviato) {
        statoInviato = false;
        invia("RIENTRATO", false, false);
    }
    // SOS
    if (sos == StatoSos::CONTO && ora >= fineConto) {
        sos = StatoSos::INVIATO;
        rifSos = 1000 + (int)((ora / 7 + pettorale * 131) % 9000);
        tentativiSos = 0;
        prossimoSos = ora;
        tInvioSos = ora;
        evento({"sos", SOS, "", "", "Richiesta di soccorso inviata."});
    }
    if (sos == StatoSos::INVIATO && ora >= prossimoSos) {
        tentativiSos++;
        prossimoSos = ora + 10000;
        invia("SOS", true, true);
    }
    if (st.fuori || sos == StatoSos::INVIATO)
        sveglia(2000);
}

bool App::tasto(Tasto k, int64_t ora)
{
    oraMs = ora;
    if (sos == StatoSos::CONTO && (k == Tasto::CORONA || k == Tasto::TOCCO || k == Tasto::PREMUTO_LUNGO)) {
        sos = StatoSos::PRONTO;
        az.diario.push_back("SOS annullato.");
        sveglia(5000);
        return true;
    }
    switch (k) {
    case Tasto::CORONA_LUNGA:
        if (sos == StatoSos::PRONTO) {
            sos = StatoSos::CONTO;
            fineConto = ora + 5000;
            pagina = Pagina::SOS;
            az.vibra = Vibra::ERRORE;
            sveglia(30000);
        } else if (sos == StatoSos::INVIATO || sos == StatoSos::CONFERMATO) {
            // l'atleta ha risolto da solo: lo dice alla base
            invia("ANNULLA", true, false);
            sos = StatoSos::PRONTO;
            az.diario.push_back("SOS ritirato: avvisata la base.");
            az.vibra = Vibra::TOCCO;
            sveglia(8000);
        }
        return true;
    case Tasto::PREMUTO_LUNGO:
        if (pagina == Pagina::SOS && sos == StatoSos::PRONTO && !visuale) {
            sos = StatoSos::CONTO;
            fineConto = ora + 5000;
            az.vibra = Vibra::ERRORE;
            sveglia(30000);
            return true;
        }
        return true;
    case Tasto::CORONA:
        visuale = !visuale;
        if (visuale)
            zoom = 0;
        else
            accesoFino = ora + 4000;
        az.diario.push_back(visuale ? "Modalità mappa accesa." : "Modalità mappa spenta.");
        sveglia(4000);
        return true;
    case Tasto::TOCCO:
        if (visuale)
            zoom = (zoom + 1) % 3;
        else
            pagina = (Pagina)(((int)pagina + 1) % 4);
        sveglia(8000);
        return true;
    case Tasto::SINISTRA:
    case Tasto::DESTRA:
        visuale = false;
        pagina = (Pagina)(((int)pagina + (k == Tasto::SINISTRA ? 1 : 3)) % 4);
        sveglia(8000);
        return true;
    default:
        return false; // su e giù restano a Meshtastic
    }
}

void App::testoRicevuto(const char *s, int64_t ora)
{
    oraMs = ora;
    int p = -1, r = -1;
    if (sscanf(s, "SRM OK P%d R%d", &p, &r) == 2 && p == pettorale && r == rifSos && sos == StatoSos::INVIATO) {
        sos = StatoSos::CONFERMATO;
        tConfermaSos = ora;
        evento({"sos-ok", SOS, "", "", "Soccorso avvisato. Resta dove sei."});
    }
}

// ======================= DISEGNO =======================

void lineaSpessa(Tela &t, double x0, double y0, double x1, double y1, double w)
{
    double dx = x1 - x0, dy = y1 - y0, L = std::hypot(dx, dy);
    if (L < 0.5) {
        t.cerchio((int)x0, (int)y0, (int)(w / 2), true);
        return;
    }
    double nx = -dy / L * w / 2, ny = dx / L * w / 2;
    t.triangolo((int)(x0 + nx), (int)(y0 + ny), (int)(x1 + nx), (int)(y1 + ny), (int)(x1 - nx), (int)(y1 - ny));
    t.triangolo((int)(x0 + nx), (int)(y0 + ny), (int)(x1 - nx), (int)(y1 - ny), (int)(x0 - nx), (int)(y0 - ny));
    t.cerchio((int)x1, (int)y1, (int)(w / 2), true);
    t.cerchio((int)x0, (int)y0, (int)(w / 2), true);
}

void punta(Tela &t, double x, double y, double ang, double k)
{
    double a = rad(ang), c = std::cos(a), s = std::sin(a);
    auto P = [&](double px, double py, int &ox, int &oy) {
        ox = (int)(x + px * c - py * s);
        oy = (int)(y + px * s + py * c);
    };
    int x0, y0, x1, y1, x2, y2;
    P(0, -30 * k, x0, y0);
    P(24 * k, 6 * k, x1, y1);
    P(-24 * k, 6 * k, x2, y2);
    t.triangolo(x0, y0, x1, y1, x2, y2);
}

// cifre a sette segmenti, grandi e leggibili al sole
void App::numeroGrande(Tela &t, int x, int y, int h, const char *str, Allinea a)
{
    static const uint8_t SEG[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
    int w = h * 55 / 100, sp = std::max(2, h * 13 / 100), gap = h * 14 / 100;
    int tot = 0;
    for (const char *c = str; *c; c++)
        tot += (*c >= '0' && *c <= '9') ? w + gap : (*c == ',' || *c == '.' || *c == ':') ? sp * 2 + gap : w / 2 + gap;
    tot -= gap;
    int cx = a == Allinea::SINISTRA ? x : a == Allinea::CENTRO ? x - tot / 2 : x - tot;
    for (const char *c = str; *c; c++) {
        if (*c >= '0' && *c <= '9') {
            uint8_t m = SEG[*c - '0'];
            int hh = h / 2;
            if (m & 0x01) t.rettangolo(cx, y, w, sp, true);                      // a
            if (m & 0x02) t.rettangolo(cx + w - sp, y, sp, hh + sp / 2, true);    // b
            if (m & 0x04) t.rettangolo(cx + w - sp, y + hh, sp, h - hh, true);    // c
            if (m & 0x08) t.rettangolo(cx, y + h - sp, w, sp, true);              // d
            if (m & 0x10) t.rettangolo(cx, y + hh, sp, h - hh, true);             // e
            if (m & 0x20) t.rettangolo(cx, y, sp, hh + sp / 2, true);             // f
            if (m & 0x40) t.rettangolo(cx, y + hh - sp / 2, w, sp, true);         // g
            cx += w + gap;
        } else if (*c == ',' || *c == '.') {
            t.rettangolo(cx, y + h - sp * 2, sp, sp * 2, true);
            cx += sp * 2 + gap;
        } else if (*c == ':') {
            t.rettangolo(cx, y + h / 4, sp, sp, true);
            t.rettangolo(cx, y + h * 3 / 4 - sp, sp, sp, true);
            cx += sp * 2 + gap;
        } else
            cx += w / 2 + gap;
    }
}

void App::testoCentrato(Tela &t, const char *str, int y, Dim d, int maxW)
{
    // a capo sulle parole
    std::string resto = str;
    int W = t.larghezza(), h = t.altezzaTesto(d) + 2;
    while (!resto.empty()) {
        size_t taglio = std::string::npos; // npos = sta tutto
        if (t.larghezzaTesto(resto.c_str(), d) > maxW) {
            size_t q = resto.find(' '), buono = q;
            while (q != std::string::npos) {
                if (t.larghezzaTesto(resto.substr(0, q).c_str(), d) > maxW)
                    break;
                buono = q;
                q = resto.find(' ', q + 1);
            }
            taglio = buono;
        }
        std::string riga = resto.substr(0, taglio);
        t.testo(W / 2, y, riga.c_str(), d, Allinea::CENTRO);
        y += h;
        resto = taglio == std::string::npos ? "" : resto.substr(taglio + 1);
    }
}

void App::freccia(Tela &t, const Bivio *b, int cx, int cy, double k)
{
    t.nero(false);
    lineaSpessa(t, cx, cy + 75 * k, cx, cy, 20 * k); // tronco
    auto ramo = [&](double ang, double L, double w, bool conPunta) {
        double x = cx + std::sin(rad(ang)) * L * k, y = cy - std::cos(rad(ang)) * L * k;
        lineaSpessa(t, cx, cy, x, y, w * k);
        if (conPunta)
            punta(t, x, y, ang, k);
    };
    if (!b) {
        ramo(0, 125, 22, true);
        return;
    }
    if (!std::strcmp(b->tipo, "tornanti")) {
        double p[5][2] = {{0, 0}, {40, -25}, {-40, -50}, {40, -75}, {-10, -110}};
        for (int i = 1; i < 5; i++)
            lineaSpessa(t, cx + p[i - 1][0] * k, cy + p[i - 1][1] * k, cx + p[i][0] * k, cy + p[i][1] * k, 16 * k);
        punta(t, cx - 10 * k, cy - 110 * k, -20, k * 0.8);
        return;
    }
    if (!std::strcmp(b->tipo, "sentiero")) {
        ramo(0, 120, 22, true);
        t.testo(cx + (int)(40 * k), cy - (int)(95 * k), b->sentiero, Dim::MEDIO, Allinea::SINISTRA);
        return;
    }
    int scelta = b->icona;
    double altri[6];
    int na = 0;
    if (b->rami >= 3)
        for (int i = 0; i < b->rami && na < 6; i++)
            altri[na++] = -75 + 150.0 * i / (b->rami - 1);
    else if (b->altri) {
        if (b->altri & 1) altri[na++] = -72;
        if (b->altri & 2) altri[na++] = 72;
    } else if (!std::strcmp(b->tipo, "bivio") && std::abs(scelta) >= 20)
        altri[na++] = 0;
    for (int i = 0; i < na; i++)
        if (std::fabs(norm(altri[i] - scelta)) > 25)
            ramo(altri[i], 100, 9, false); // gli altri sentieri: sottili
    if (b->giro1 || b->giro2) {
        double a1 = b->giro1, a2 = a1 + b->giro2;
        double x1 = cx + std::sin(rad(a1)) * 60 * k, y1 = cy - std::cos(rad(a1)) * 60 * k;
        double x2 = x1 + std::sin(rad(a2)) * 80 * k, y2 = y1 - std::cos(rad(a2)) * 80 * k;
        lineaSpessa(t, cx, cy, x1, y1, 22 * k);
        lineaSpessa(t, x1, y1, x2, y2, 22 * k);
        punta(t, x2, y2, a2, k);
        return;
    }
    ramo(scelta, 125, 24, true);
}

void App::barra(Tela &t)
{
    int W = t.larghezza();
    char b[24];
    if (oraLoc >= 0) {
        snprintf(b, sizeof b, "%d:%02d", oraLoc / 3600 % 24, oraLoc / 60 % 60);
        t.testo(X(60), X(12), b, Dim::MEDIO, Allinea::SINISTRA);
    }
    bool gpsOk = haFix && oraMs - tFix < 5000;
    t.testo(W / 2, X(18), gpsOk ? "GPS" : "GPS ?", Dim::PICCOLO, Allinea::CENTRO);
    t.zona(W / 2 - X(40), X(14), X(80), X(26), gpsOk ? Colore::VERDE : Colore::ROSSO, Colore::NERO);
    if (batt >= 0 && batt <= 100) {
        snprintf(b, sizeof b, "%d%%", batt);
        t.testo(W - X(60), X(18), b, Dim::PICCOLO, Allinea::DESTRA);
        if (batt <= 20)
            t.zona(W - X(130), X(14), X(72), X(26), Colore::ROSSO, Colore::NERO);
    }
}

void App::sottotitoloDisegna(Tela &t, int y)
{
    if (sottotitolo.empty() || oraMs > sottotitoloFino)
        return;
    testoCentrato(t, sottotitolo.c_str(), y, Dim::PICCOLO, t.larghezza() - X(70));
    t.zona(0, y - 2, t.larghezza(), X(70), Colore::TENUE, Colore::NERO);
}

void App::disegna(Tela &t, int64_t ora)
{
    oraMs = ora;
    s = t.larghezza() / 410.0;
    t.pulisci();
    t.nero(false);
    Stato st = motore.stato();
    bool errore = st.fuori || (ultimoTipo == "indietro" && ora - ultimoT < 15000);
    bool inSos = pagina == Pagina::SOS || sos == StatoSos::CONTO;
    if (visuale && !errore && !inSos) {
        paginaVisuale(t, st);
        return;
    }
    barra(t);
    if (inSos)
        paginaSos(t);
    else if (errore)
        paginaErrore(t, st);
    else if (pagina == Pagina::GUIDA)
        paginaGuida(t, st);
    else if (pagina == Pagina::MAPPA)
        paginaMappa(t, st);
    else
        paginaGara(t, st);
    // puntini delle pagine
    int W = t.larghezza(), H = t.altezza();
    for (int i = 0; i < 4; i++)
        t.cerchio(W / 2 + X((i - 1.5) * 18), H - X(14), i == (int)pagina ? X(5) : X(3), i == (int)pagina);
}

void App::paginaGuida(Tela &t, const Stato &st)
{
    int W = t.larghezza(), H = t.altezza();
    char b[48];
    if (!st.agganciato) {
        testoCentrato(t, "Cerco il percorso...", X(200), Dim::MEDIO, W - X(60));
        sottotitoloDisegna(t, X(330));
        return;
    }
    if (st.arrivato) {
        testoCentrato(t, "ARRIVO!", X(190), Dim::MEDIO, W);
        testoCentrato(t, "Forgia la tua medaglia", X(240), Dim::PICCOLO, W);
        t.zona(0, X(180), W, X(90), Colore::VERDE, Colore::NERO);
        return;
    }
    const Prossimo &p = st.prossimo;
    if (p.b && p.d <= 1000) {
        bool vicino = p.d <= 220;
        int cx = W / 2, cy = X(200);
        freccia(t, p.b, cx, cy, 0.9 * s);
        t.zona(cx - X(150), cy - X(150), X(300), X(260), Colore::VERDE, Colore::NERO);
        if (p.d < 30)
            testoCentrato(t, "ORA", X(310), Dim::MEDIO, W);
        else {
            snprintf(b, sizeof b, "%d", metriParlati(p.d));
            numeroGrande(t, W / 2 - X(14), X(296), X(64), b, Allinea::CENTRO);
            int lw = 0;
            (void)lw;
            t.testo(W / 2 + X(64) * 55 / 100 * (int)std::strlen(b) / 2 + X(4), X(328), "m", Dim::MEDIO, Allinea::SINISTRA);
        }
        t.zona(0, X(290), W, X(76), vicino ? Colore::AMBRA : Colore::BIANCO, Colore::NERO);
        testoCentrato(t, p.b->titolo, X(372), Dim::MEDIO, W - X(50));
    } else {
        freccia(t, nullptr, W / 2, X(190), 0.7 * s);
        t.zona(W / 2 - X(80), X(80), X(160), X(200), Colore::VERDE, Colore::NERO);
        testoCentrato(t, "Dritto", X(285), Dim::MEDIO, W);
        if (p.b)
            snprintf(b, sizeof b, "prossimo bivio fra %s km", kmParlati(p.d / 1000).c_str());
        else
            snprintf(b, sizeof b, "arrivo fra %s km", kmParlati(T.kmTot - st.km).c_str());
        testoCentrato(t, b, X(322), Dim::PICCOLO, W - X(40));
        if (st.sentiero && *st.sentiero) {
            snprintf(b, sizeof b, "Sentiero %s", st.sentiero);
            testoCentrato(t, b, X(356), Dim::MEDIO, W);
            t.zona(0, X(354), W, X(34), Colore::VERDE, Colore::NERO);
        }
    }
    // piede: chilometro, quota e avanzamento
    double q[3];
    T.at(st.km, q);
    snprintf(b, sizeof b, "km %s / %s", kmParlati(st.km).c_str(), kmParlati(T.kmTot).c_str());
    t.testo(X(50), H - X(62), b, Dim::PICCOLO, Allinea::SINISTRA);
    snprintf(b, sizeof b, "%d m", (int)std::lround(q[2]));
    t.testo(W - X(50), H - X(62), b, Dim::PICCOLO, Allinea::DESTRA);
    t.rettangolo(X(50), H - X(74), W - X(100), X(6), false);
    t.rettangolo(X(50), H - X(74), (int)((W - X(100)) * st.km / T.kmTot), X(6), true);
    t.zona(X(50), H - X(76), W - X(100), X(10), Colore::VERDE, Colore::NERO);
    if (!(p.b && p.d <= 1000))
        sottotitoloDisegna(t, X(392)); // col bivio vicino la frase è già scritta grande
}

void App::paginaErrore(Tela &t, const Stato &st)
{
    int W = t.larghezza();
    bool indietro = !st.fuori;
    const char *titolo = indietro ? "SENSO SBAGLIATO" : st.sbagliato ? "SENTIERO SBAGLIATO" : "FUORI PERCORSO";
    t.testo(W / 2, X(70), titolo, Dim::MEDIO, Allinea::CENTRO);
    double ang = 180, d = st.dist;
    if (!indietro && haFix && st.agganciato && !st.sbagliato) {
        Traccia::Proiezione v = T.proietta(fix.lat, fix.lon, std::max(0.0, st.km - 0.3), st.km + 1.5);
        double q[3];
        T.at(v.km, q);
        d = v.d;
        double b = rotta(fix.lat, fix.lon, q[0], q[1]);
        ang = motore.haDirezione() ? norm(b - motore.direzione()) : 0;
    }
    // freccia grande verso il percorso, rispetto al senso di marcia
    double cx = W / 2, cy = X(215), a = rad(ang), c = std::cos(a), sn = std::sin(a);
    auto P = [&](double px, double py, int &ox, int &oy) {
        ox = (int)(cx + (px * c - py * sn) * s);
        oy = (int)(cy + (px * sn + py * c) * s);
    };
    int x0, y0, x1, y1, x2, y2, x3, y3;
    P(0, -95, x0, y0);
    P(62, -20, x1, y1);
    P(-62, -20, x2, y2);
    t.triangolo(x0, y0, x1, y1, x2, y2);
    P(22, -21, x0, y0);
    P(22, 80, x1, y1);
    P(-22, 80, x2, y2);
    P(-22, -21, x3, y3);
    t.triangolo(x0, y0, x1, y1, x2, y2);
    t.triangolo(x0, y0, x2, y2, x3, y3);
    char b[24];
    if (indietro)
        testoCentrato(t, "Girati", X(330), Dim::MEDIO, W);
    else {
        snprintf(b, sizeof b, "%d", metriParlati(d));
        numeroGrande(t, W / 2 - X(14), X(318), X(56), b, Allinea::CENTRO);
        t.testo(W / 2 + X(56) * 55 / 100 * (int)std::strlen(b) / 2 + X(4), X(344), "m", Dim::MEDIO, Allinea::SINISTRA);
    }
    t.zona(0, X(56), W, X(330), Colore::BIANCO, Colore::ROSSO_SCURO);
    t.zona(0, X(60), W, X(40), Colore::ROSSO, Colore::ROSSO_SCURO);
    sottotitoloDisegna(t, X(400));
}

void App::paginaMappa(Tela &t, const Stato &st)
{
    int W = t.larghezza(), H = t.altezza();
    if (!st.agganciato) {
        testoCentrato(t, "Cerco il percorso...", X(200), Dim::MEDIO, W - X(60));
        return;
    }
    // il percorso davanti verso l'alto (dalla traccia, senza bussola); 1 km circa 300 px
    double km = st.km, dir = T.direzioneDopo(km, 0.15);
    double o[3];
    T.at(km, o);
    double k = std::cos(rad(o[0])), sc = 0.30 * s, cx = W / 2, cy = X(330), r = rad(dir);
    auto xy = [&](double la, double lo, double &px, double &py) {
        double x = (lo - o[1]) * k * 111320, y = (la - o[0]) * 110540;
        double xr = x * std::cos(r) - y * std::sin(r), yr = x * std::sin(r) + y * std::cos(r);
        px = cx + xr * sc;
        py = cy - yr * sc;
    };
    auto tratto = [&](double a, double b, double w) {
        double q[3], px0 = 0, py0 = 0, px, py;
        for (double x = a; x <= b + 1e-9; x += 0.01) {
            T.at(x, q);
            xy(q[0], q[1], px, py);
            if (x > a)
                lineaSpessa(t, px0, py0, px, py, w);
            px0 = px;
            py0 = py;
        }
    };
    tratto(std::max(0.0, km - 0.4), km, 3 * s);
    tratto(km, std::min(T.kmTot, km + 1.3), 10 * s);
    t.zona(0, X(60), W, X(380), Colore::VERDE, Colore::NERO);
    for (int i = 0; i < motore.nBivi; i++) {
        const Bivio &b = motore.bivi[i];
        if (b.silenzioso || b.km < km || b.km > km + 1.3)
            continue;
        double px, py;
        xy(b.lat, b.lon, px, py);
        t.cerchio((int)px, (int)py, X(10), true);
        t.zona((int)px - X(11), (int)py - X(11), X(22), X(22), Colore::AMBRA, Colore::NERO);
    }
    if (haFix) {
        double px, py;
        xy(fix.lat, fix.lon, px, py);
        t.cerchio((int)px, (int)py, X(14), true);
        t.nero(true);
        t.cerchio((int)px, (int)py, X(8), true);
        t.nero(false);
        t.cerchio((int)px, (int)py, X(5), true);
        t.zona((int)px - X(15), (int)py - X(15), X(30), X(30), Colore::BLU, Colore::NERO);
    }
    t.testo(X(50), H - X(64), "100 m", Dim::PICCOLO, Allinea::SINISTRA);
    t.rettangolo(X(50), H - X(40), X(30), X(4), true);
    if (st.sentiero && *st.sentiero) {
        char b[32];
        snprintf(b, sizeof b, "Sentiero %s", st.sentiero);
        t.testo(W - X(50), H - X(64), b, Dim::PICCOLO, Allinea::DESTRA);
    }
}

void App::paginaGara(Tela &t, const Stato &st)
{
    int W = t.larghezza();
    char b[48];
    int trascorsi = oraLoc >= 0 ? oraLoc - partenzaSec : -1;
    if (trascorsi >= 0) {
        snprintf(b, sizeof b, "%d:%02d", trascorsi / 3600, trascorsi / 60 % 60);
        numeroGrande(t, W / 2, X(70), X(70), b, Allinea::CENTRO);
        t.testo(W / 2, X(150), "tempo di gara", Dim::PICCOLO, Allinea::CENTRO);
    }
    if (!st.agganciato)
        return;
    snprintf(b, sizeof b, "km %s", kmParlati(st.km).c_str());
    t.testo(W / 2, X(182), b, Dim::MEDIO, Allinea::CENTRO);
    // profilo altimetrico con la posizione
    int x0 = X(40), x1 = W - X(40), y0 = X(300), y1 = X(232);
    double qmin = 700, qmax = 2400, q[3], px0 = 0, py0 = 0;
    for (double k = 0; k <= T.kmTot; k += 0.2) {
        T.at(k, q);
        double x = x0 + (x1 - x0) * k / T.kmTot, y = y0 + (y1 - y0) * (q[2] - qmin) / (qmax - qmin);
        if (k > 0)
            t.linea((int)px0, (int)py0, (int)x, (int)y);
        px0 = x;
        py0 = y;
    }
    T.at(st.km, q);
    int pxp = (int)(x0 + (x1 - x0) * st.km / T.kmTot), pyp = (int)(y0 + (y1 - y0) * (q[2] - qmin) / (qmax - qmin));
    t.cerchio(pxp, pyp, X(8), true);
    t.zona(pxp - X(9), pyp - X(9), X(18), X(18), Colore::BLU, Colore::NERO);
    // prossimo cancello orario
    struct C {
        double km;
        const char *nome;
        int ora;
    } cancelli[] = {{10, "Passo Le Forche", 10 * 3600 + 45 * 60}, {14.71, "Capanna di Sevice", 12 * 3600 + 45 * 60}, {29.706, "Arrivo", 16 * 3600}};
    for (auto &c : cancelli) {
        if (c.km <= st.km + 0.05)
            continue;
        t.testo(W / 2, X(322), c.nome, Dim::MEDIO, Allinea::CENTRO);
        snprintf(b, sizeof b, "%s ore %d:%02d", c.km > 29 ? "tempo massimo" : "cancello", c.ora / 3600, c.ora / 60 % 60);
        t.testo(W / 2, X(356), b, Dim::PICCOLO, Allinea::CENTRO);
        if (trascorsi > 60 && st.km > 0.2) {
            double vel = st.km / trascorsi; // km al secondo
            int stima = oraLoc + (int)((c.km - st.km) / vel);
            int margine = (c.ora - stima) / 60;
            if (margine >= 0)
                snprintf(b, sizeof b, "margine %d min", margine);
            else
                snprintf(b, sizeof b, "in ritardo di %d min", -margine);
            t.testo(W / 2, X(388), b, Dim::MEDIO, Allinea::CENTRO);
            t.zona(0, X(386), W, X(34), margine >= 20 ? Colore::VERDE : margine >= 0 ? Colore::AMBRA : Colore::ROSSO, Colore::NERO);
        }
        break;
    }
}

void App::paginaSos(Tela &t)
{
    int W = t.larghezza();
    char b[64];
    switch (sos) {
    case StatoSos::PRONTO:
        t.cerchio(W / 2, X(220), X(110), true);
        t.nero(true);
        t.testo(W / 2, X(206), "SOS", Dim::MEDIO, Allinea::CENTRO);
        t.nero(false);
        t.zona(W / 2 - X(112), X(108), X(224), X(224), Colore::ROSSO_SCURO, Colore::NERO);
        t.zona(W / 2 - X(40), X(200), X(80), X(36), Colore::BIANCO, Colore::ROSSO_SCURO);
        testoCentrato(t, "Tieni premuta la corona per 3 secondi", X(350), Dim::PICCOLO, W - X(90));
        break;
    case StatoSos::CONTO: {
        int r = (int)std::max<int64_t>(0, (fineConto - oraMs + 999) / 1000);
        t.cerchio(W / 2, X(220), X(110), true);
        snprintf(b, sizeof b, "%d", r);
        t.nero(true);
        numeroGrande(t, W / 2, X(180), X(80), b, Allinea::CENTRO);
        t.nero(false);
        t.zona(W / 2 - X(112), X(108), X(224), X(224), Colore::ROSSO, Colore::NERO);
        testoCentrato(t, "Invio fra poco. Premi la corona per annullare.", X(350), Dim::PICCOLO, W - X(90));
        break;
    }
    case StatoSos::INVIATO:
        t.testo(W / 2, X(110), "SOS INVIATO", Dim::MEDIO, Allinea::CENTRO);
        t.zona(0, X(106), W, X(36), Colore::ROSSO, Colore::NERO);
        snprintf(b, sizeof b, "Sto avvisando la base (invio %d)", tentativiSos);
        testoCentrato(t, b, X(180), Dim::PICCOLO, W - X(90));
        testoCentrato(t, "Resta dove sei. Copriti.", X(280), Dim::MEDIO, W - X(60));
        t.zona(0, X(276), W, X(70), Colore::AMBRA, Colore::NERO);
        break;
    case StatoSos::CONFERMATO:
        t.testo(W / 2, X(110), "SOCCORSO AVVISATO", Dim::MEDIO, Allinea::CENTRO);
        t.zona(0, X(106), W, X(36), Colore::VERDE, Colore::NERO);
        snprintf(b, sizeof b, "La base ha ricevuto la tua posizione (in %d s).", (int)((tConfermaSos - tInvioSos) / 1000));
        testoCentrato(t, b, X(180), Dim::PICCOLO, W - X(90));
        testoCentrato(t, "Resta dove sei. Copriti.", X(280), Dim::MEDIO, W - X(60));
        t.zona(0, X(276), W, X(70), Colore::AMBRA, Colore::NERO);
        testoCentrato(t, "Corona tenuta 3 s: annulla l'SOS", X(380), Dim::PICCOLO, W - X(90));
        break;
    }
}

// modalità mappa (corona): percorso intorno, nord in alto, con la posizione; il bivio vicino resta in basso
void App::paginaVisuale(Tela &t, const Stato &st)
{
    int W = t.larghezza(), H = t.altezza();
    static const double MPP[3] = {2, 5, 24};
    static const char *NOME[3] = {"800 m", "2 km", "tutto"};
    double mpp = MPP[zoom] / s;
    double c[2];
    if (zoom == 2) {
        c[0] = centro[0];
        c[1] = centro[1];
    } else if (haFix) {
        c[0] = fix.lat;
        c[1] = fix.lon;
    } else {
        double q[3];
        T.at(st.agganciato ? st.km : 0, q);
        c[0] = q[0];
        c[1] = q[1];
    }
    double k = std::cos(rad(c[0]));
    auto xy = [&](double la, double lo, double &px, double &py) {
        px = W / 2 + (lo - c[1]) * k * 111320 / mpp;
        py = H / 2 - (la - c[0]) * 110540 / mpp;
    };
    double km = st.agganciato ? st.km : 0, passo = std::max(0.005, mpp * 3 / 1000), q[3], px0 = 0, py0 = 0, px, py;
    for (double x = 0; x <= T.kmTot + 1e-9; x += passo) {
        T.at(x, q);
        xy(q[0], q[1], px, py);
        if (x > 0)
            lineaSpessa(t, px0, py0, px, py, x < km ? 2 * s : 6 * s);
        px0 = px;
        py0 = py;
    }
    t.zona(0, 0, W, H, Colore::ARANCIO, Colore::NERO);
    for (int i = 0; i < motore.nBivi; i++) {
        const Bivio &b = motore.bivi[i];
        if (b.silenzioso || b.km < km || b.km > km + (zoom == 2 ? 30 : 3))
            continue;
        xy(b.lat, b.lon, px, py);
        int r = zoom == 2 ? X(4) : X(8);
        t.cerchio((int)px, (int)py, r, true);
        t.zona((int)px - r - 1, (int)py - r - 1, 2 * r + 2, 2 * r + 2, Colore::AMBRA, Colore::NERO);
    }
    if (haFix) {
        xy(fix.lat, fix.lon, px, py);
        if (motore.haDirezione()) {
            double a = rad(motore.direzione());
            punta(t, px + std::sin(a) * 26 * s, py - std::cos(a) * 26 * s, motore.direzione(), 0.6 * s);
        }
        t.cerchio((int)px, (int)py, X(13), true);
        t.nero(true);
        t.cerchio((int)px, (int)py, X(7), true);
        t.nero(false);
        t.cerchio((int)px, (int)py, X(4), true);
        t.zona((int)px - X(40), (int)py - X(40), X(80), X(80), Colore::BLU, Colore::NERO);
    }
    // barra in alto e indicazioni in basso su fondo nero
    t.nero(true);
    t.rettangolo(0, 0, W, X(56), true);
    t.nero(false);
    barra(t);
    char b[48];
    snprintf(b, sizeof b, "MAPPA %s", NOME[zoom]);
    t.testo(X(60), X(64), b, Dim::PICCOLO, Allinea::SINISTRA);
    t.zona(X(56), X(62), t.larghezzaTesto(b, Dim::PICCOLO) + X(8), X(24), Colore::BIANCO, Colore::NERO);
    const Prossimo &p = st.prossimo;
    bool vicino = p.b && p.d <= 300 && !st.arrivato;
    int hB = vicino ? X(120) : X(80);
    t.nero(true);
    t.rettangolo(0, H - hB, W, hB, true);
    t.nero(false);
    if (vicino) {
        freccia(t, p.b, X(80), H - X(62), 0.34 * s);
        t.zona(X(30), H - hB, X(100), hB, Colore::VERDE, Colore::NERO);
        if (p.d < 30)
            t.testo(X(140), H - X(110), "ORA", Dim::MEDIO, Allinea::SINISTRA);
        else {
            snprintf(b, sizeof b, "%d m", metriParlati(p.d));
            t.testo(X(140), H - X(110), b, Dim::MEDIO, Allinea::SINISTRA);
        }
        t.zona(X(136), H - hB, W - X(136), X(40), Colore::AMBRA, Colore::NERO);
        t.testo(X(140), H - X(76), p.b->titolo, Dim::PICCOLO, Allinea::SINISTRA);
    } else if (st.agganciato) {
        snprintf(b, sizeof b, "km %s", kmParlati(st.km).c_str());
        t.testo(X(60), H - X(72), b, Dim::MEDIO, Allinea::SINISTRA);
        if (p.b)
            snprintf(b, sizeof b, "bivio fra %d m", metriParlati(p.d));
        else
            snprintf(b, sizeof b, "verso l'arrivo");
        if (p.b && p.d >= 1000)
            snprintf(b, sizeof b, "bivio fra %s km", kmParlati(p.d / 1000).c_str());
        t.testo(W - X(60), H - X(66), b, Dim::PICCOLO, Allinea::DESTRA);
    }
}

} // namespace srm
