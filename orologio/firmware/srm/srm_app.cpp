#include "srm_app.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace srm
{

static const double K_PI = 3.14159265358979323846;
static inline double rad(double d) { return d * K_PI / 180; }
static inline double norm(double a) { return std::fmod(std::fmod(a, 360.0) + 540.0, 360.0) - 180.0; }

static int primoNumero(const std::string &s)
{
    for (size_t i = 0; i < s.size(); i++)
        if (s[i] >= '0' && s[i] <= '9')
            return atoi(s.c_str() + i);
    return -1;
}

// distanza parlata → pezzo registrato più vicino
static std::string pezzoMetri(const char *pre, int m, const int *valori, int n)
{
    int best = valori[0];
    for (int i = 0; i < n; i++)
        if (std::abs(valori[i] - m) < std::abs(best - m))
            best = valori[i];
    return std::string(pre) + std::to_string(best);
}

std::vector<std::string> clipPerEvento(const Evento &e, bool dopoErrore)
{
    static const int PRE[] = {100, 150, 200, 250, 300, 350, 400, 450, 500};
    static const int DIST[] = {10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 400, 500};
    const std::string &k = e.tipo, &t = e.testo;
    std::vector<std::string> v;
    if (k == "preavviso")
        v = {"fra", pezzoMetri("m", primoNumero(t), PRE, 9), "pre_" + e.bivio};
    else if (k == "indicazione")
        v = {"ind_" + e.bivio};
    else if (k == "ora")
        v = {"ora_" + e.bivio};
    else if (k == "giusto")
        v = {dopoErrore ? "bene" : "ok_" + e.bivio};
    else if (k == "fuori") {
        v.push_back(t.rfind("Ancora", 0) == 0 ? "ancora_fuori" : "fuori");
        bool km = t.find("chilometri") != std::string::npos;
        v.push_back("percorso_a");
        v.push_back(km ? "d500" : pezzoMetri("d", primoNumero(t.substr(t.find("Percorso a"))), DIST, 16));
        v.push_back(t.find("destra") != std::string::npos      ? "lato_destra"
                    : t.find("sinistra") != std::string::npos  ? "lato_sinistra"
                    : t.find("davanti") != std::string::npos   ? "lato_davanti"
                                                               : "lato_spalle");
        if (t.find("sui tuoi passi") != std::string::npos)
            v.push_back("torna_passi");
    } else if (k == "sbagliato")
        v = {t.rfind("Sentiero", 0) == 0 ? "sbagliato" : "torna_indietro"};
    else if (k == "rientro")
        v = {"rientro"};
    else if (k == "indietro")
        v = {"contrario"};
    else if (k == "gps")
        v = {"gps_debole"};
    else if (k == "gps-ok")
        v = {"gps_ok"};
    else if (k == "aggancio" || k == "conferma" || k == "attesa")
        v = {"sul_percorso"};
    else if (k == "arrivo")
        v = {"arrivo"};
    else if (k == "sos")
        v = {"sos_inviato"};
    else if (k == "sos-ok")
        v = {"sos_ok"};
    else if (k == "lontano")
        v = {"fuori"};
    return v;
}

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
    ampiezza[0] = (d - c) * std::cos(rad(centro[0])) * 111320;
    ampiezza[1] = (b - a) * 110540;
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
        if (k == "sos" || k == "sos-ok")
            pagina = Pagina::SOS;
        else if (pagina != Pagina::MAPPA) // chi guarda la mappa ci resta: bivio ed errori compaiono lì sotto
            pagina = Pagina::GUIDA;
    }
    std::string testo = e.testo;
    // sull'orologio non c'è il comando «Torna indietro» del telefono
    if (k == "indietro")
        testo = "Stai andando al contrario. Girati.";
    if (!testo.empty()) {
        sottotitolo = testo;
        sottotitoloFino = oraMs + 7000;
        az.diario.push_back(testo);
        bool dopoErrore = !e.bivio.empty() && testo.rfind("Bene", 0) == 0;
        az.voce = clipPerEvento({e.tipo, e.priorita, e.suono, e.bivio, testo}, dopoErrore);
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
    if (aiutoFino == 0) { // prima accensione: la pagina «come si usa» resta 25 secondi
        aiutoFino = ora + 25000;
        accesoFino = std::max(accesoFino, aiutoFino);
    }
    if (aiuto && ora > aiutoFino)
        aiuto = false;
    dalMotore(motore.tick(ora));
    Stato st = motore.stato();
    // finché la guida non è agganciata: quanto manca al percorso (per dirlo sullo schermo)
    distTraccia = (!st.agganciato && haFix && ora - tFix < 10000) ? T.proietta(fix.lat, fix.lon, 0, T.kmTot).d : -1;
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

void App::vaiA(Pagina p)
{
    pagina = p;
    // la mappa resta accesa due minuti dopo l'ultimo tocco, le altre pagine dieci secondi
    sveglia(p == Pagina::MAPPA ? 120000 : 10000);
    if (p == Pagina::MAPPA)
        suggerimentoFino = oraMs + 6000;
}

bool App::tasto(Tasto k, int64_t ora, int x, int y)
{
    oraMs = ora;
    if (k == Tasto::SU || k == Tasto::GIU)
        return false; // restano a Meshtastic
    auto conferma = [&] {
        if (az.vibra == Vibra::NESSUNA)
            az.vibra = Vibra::TOCCO; // ogni comando accettato si sente al polso
    };
    if (aiuto && k != Tasto::PULSANTE_LUNGO) { // il primo tocco chiude «come si usa»
        aiuto = false;
        conferma();
        sveglia(10000);
        return true;
    }
    aiuto = false;
    if (sos == StatoSos::CONTO && k != Tasto::PULSANTE_LUNGO) { // qualsiasi comando ferma il conto alla rovescia
        sos = StatoSos::PRONTO;
        az.diario.push_back("SOS annullato.");
        conferma();
        sveglia(8000);
        return true;
    }
    auto avviaSos = [&] {
        sos = StatoSos::CONTO;
        fineConto = ora + 5000;
        pagina = Pagina::SOS;
        az.vibra = Vibra::ERRORE;
        sveglia(30000);
    };
    switch (k) {
    case Tasto::PULSANTE_LUNGO:
        if (sos == StatoSos::PRONTO)
            avviaSos();
        else if (sos == StatoSos::INVIATO || sos == StatoSos::CONFERMATO) {
            // l'atleta ha risolto da solo: lo dice alla base (solo con il tasto: un tocco per sbaglio non basta)
            invia("ANNULLA", true, false);
            sos = StatoSos::PRONTO;
            az.diario.push_back("SOS ritirato: avvisata la base.");
            az.vibra = Vibra::TOCCO;
            sveglia(8000);
        }
        return true;
    case Tasto::PREMUTO_LUNGO:
        if (pagina == Pagina::SOS && sos == StatoSos::PRONTO && (y < 0 || y < ultimaH - X(70)))
            avviaSos();
        return true;
    case Tasto::PULSANTE:
        vaiA((Pagina)(((int)pagina + 1) % 4));
        conferma();
        return true;
    case Tasto::TOCCO:
        if (y >= 0 && y >= ultimaH - X(74)) { // le linguette in basso
            int i = (x - X(28)) * 4 / std::max(1, ultimaW - X(56));
            vaiA((Pagina)std::max(0, std::min(3, i)));
        } else if (pagina == Pagina::MAPPA) {
            zoom = (zoom + 1) % 3;
            sveglia(120000);
        } else if (pagina == Pagina::SOS) {
            sottotitolo = "Per chiedere soccorso tieni premuto.";
            sottotitoloFino = ora + 4000;
            sveglia(15000);
        } else
            vaiA((Pagina)(((int)pagina + 1) % 4));
        conferma();
        return true;
    case Tasto::SINISTRA:
    case Tasto::DESTRA:
        vaiA((Pagina)(((int)pagina + (k == Tasto::SINISTRA ? 1 : 3)) % 4));
        conferma();
        return true;
    default:
        return false;
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

// le quattro pagine, sempre scritte in basso: si toccano direttamente
void App::linguette(Tela &t)
{
    static const char *NOMI[4] = {"GUIDA", "MAPPA", "GARA", "SOS"};
    int W = t.larghezza(), H = t.altezza();
    int y0 = H - X(70), x0 = X(28), larg = (W - X(56)) / 4, hBox = X(38), yBox = H - X(62);
    int yT = yBox + (hBox - t.altezzaTesto(Dim::PICCOLO)) / 2;
    t.nero(true);
    t.rettangolo(0, y0, W, X(70), true);
    t.nero(false);
    t.rettangolo(X(20), y0, W - X(40), 1, true);
    t.zona(0, y0, W, X(70), Colore::TENUE, Colore::NERO);
    bool sosAttivo = sos != StatoSos::PRONTO;
    for (int i = 0; i < 4; i++) {
        int x = x0 + i * larg;
        bool rosso = i == 3, piena = i == (int)pagina || (rosso && sosAttivo);
        if (piena) {
            t.rettangolo(x + 2, yBox, larg - 4, hBox, true);
            t.nero(true);
        }
        t.testo(x + larg / 2, yT, NOMI[i], Dim::PICCOLO, Allinea::CENTRO);
        t.nero(false);
        if (piena || rosso)
            t.zona(x + 2, yBox, larg - 4, hBox, rosso ? Colore::ROSSO : Colore::VERDE, Colore::NERO);
    }
}

void App::sottotitoloDisegna(Tela &t, int y)
{
    if (sottotitolo.empty() || oraMs > sottotitoloFino)
        return;
    testoCentrato(t, sottotitolo.c_str(), y, Dim::PICCOLO, t.larghezza() - X(70));
    t.zona(0, y - 2, t.larghezza(), X(46), Colore::TENUE, Colore::NERO);
}

void App::disegna(Tela &t, int64_t ora)
{
    oraMs = ora;
    s = t.larghezza() / 410.0;
    ultimaW = t.larghezza();
    ultimaH = t.altezza();
    t.pulisci();
    t.nero(false);
    Stato st = motore.stato();
    bool errore = st.fuori || (ultimoTipo == "indietro" && ora - ultimoT < 15000);
    bool inSos = pagina == Pagina::SOS || sos == StatoSos::CONTO;
    if (aiuto && !inSos && !errore) {
        barra(t);
        paginaAiuto(t);
    } else if (inSos) {
        barra(t);
        paginaSos(t);
    } else if (pagina == Pagina::MAPPA)
        paginaMappa(t, st, errore); // la barra in alto la disegna lei, sopra la mappa
    else {
        barra(t);
        if (errore)
            paginaErrore(t, st);
        else if (pagina == Pagina::GUIDA)
            paginaGuida(t, st);
        else
            paginaGara(t, st);
    }
    linguette(t);
}

void App::paginaAiuto(Tela &t)
{
    int W = t.larghezza(), m = W - X(70);
    t.testo(W / 2, X(64), "COME SI USA", Dim::MEDIO, Allinea::CENTRO);
    t.zona(0, X(60), W, X(36), Colore::ARANCIO, Colore::NERO);
    testoCentrato(t, "Tocca le scritte in basso per cambiare pagina", X(112), Dim::PICCOLO, m);
    testoCentrato(t, "Un tasto laterale, uno qualsiasi: pagina dopo", X(176), Dim::PICCOLO, m);
    testoCentrato(t, "Tasto tenuto 2 secondi: SOS", X(240), Dim::MEDIO, m);
    t.zona(0, X(236), W, X(70), Colore::ROSSO, Colore::NERO);
    testoCentrato(t, "A ogni comando l'orologio vibra.", X(320), Dim::PICCOLO, m);
    testoCentrato(t, "Tocca per cominciare", X(380), Dim::PICCOLO, m);
    t.zona(0, X(316), W, X(100), Colore::TENUE, Colore::NERO);
}

void App::paginaGuida(Tela &t, const Stato &st)
{
    int W = t.larghezza(), m = W - X(70);
    char b[64];
    if (!st.agganciato) {
        // una sola pagina dice perché la guida non parte, e cosa fare
        if (!(haFix && oraMs - tFix < 10000)) {
            testoCentrato(t, "Aspetto il GPS", X(104), Dim::MEDIO, m);
            t.zona(0, X(100), W, X(36), Colore::AMBRA, Colore::NERO);
            testoCentrato(t, "Resta all'aperto, con il cielo libero. Serve qualche minuto.", X(160), Dim::PICCOLO, m);
        } else {
            testoCentrato(t, "Non sei sul percorso", X(104), Dim::MEDIO, m);
            t.zona(0, X(100), W, X(36), Colore::AMBRA, Colore::NERO);
            if (distTraccia >= 950)
                snprintf(b, sizeof b, "Il percorso di gara dista %s km", kmParlati(distTraccia / 1000).c_str());
            else
                snprintf(b, sizeof b, "Il percorso di gara dista %d m", metriParlati(std::max(0.0, distTraccia)));
            testoCentrato(t, b, X(160), Dim::PICCOLO, m);
            testoCentrato(t, "La guida parte da sola quando ci arrivi.", X(214), Dim::PICCOLO, m);
        }
        testoCentrato(t, "Tocca MAPPA per vedere il percorso", X(310), Dim::PICCOLO, m);
        t.zona(0, X(306), W, X(60), Colore::VERDE, Colore::NERO);
        sottotitoloDisegna(t, X(376));
        return;
    }
    if (st.arrivato) {
        testoCentrato(t, "ARRIVO!", X(170), Dim::MEDIO, W);
        testoCentrato(t, "Forgia la tua medaglia", X(220), Dim::PICCOLO, W);
        t.zona(0, X(160), W, X(90), Colore::VERDE, Colore::NERO);
        return;
    }
    const Prossimo &p = st.prossimo;
    bool bivio = p.b && p.d <= 1000;
    if (bivio) {
        bool vicino = p.d <= 220;
        int cx = W / 2, cy = X(172);
        freccia(t, p.b, cx, cy, 0.74 * s);
        t.zona(cx - X(130), X(58), X(260), X(176), Colore::VERDE, Colore::NERO);
        if (p.d < 30)
            testoCentrato(t, "ORA", X(250), Dim::MEDIO, W);
        else {
            snprintf(b, sizeof b, "%d", metriParlati(p.d));
            numeroGrande(t, W / 2 - X(14), X(240), X(54), b, Allinea::CENTRO);
            t.testo(W / 2 + X(54) * 55 / 100 * (int)std::strlen(b) / 2 + X(4), X(266), "m", Dim::MEDIO, Allinea::SINISTRA);
        }
        t.zona(0, X(236), W, X(62), vicino ? Colore::AMBRA : Colore::BIANCO, Colore::NERO);
        testoCentrato(t, p.b->titolo, X(302), Dim::MEDIO, W - X(50));
    } else {
        freccia(t, nullptr, W / 2, X(168), 0.6 * s);
        t.zona(W / 2 - X(70), X(58), X(140), X(160), Colore::VERDE, Colore::NERO);
        testoCentrato(t, "Dritto", X(222), Dim::MEDIO, W);
        if (p.b)
            snprintf(b, sizeof b, "prossimo bivio fra %s km", kmParlati(p.d / 1000).c_str());
        else
            snprintf(b, sizeof b, "arrivo fra %s km", kmParlati(T.kmTot - st.km).c_str());
        testoCentrato(t, b, X(256), Dim::PICCOLO, W - X(40));
        if (st.sentiero && *st.sentiero) {
            snprintf(b, sizeof b, "Sentiero %s", st.sentiero);
            testoCentrato(t, b, X(284), Dim::MEDIO, W);
            t.zona(0, X(282), W, X(34), Colore::VERDE, Colore::NERO);
        }
        sottotitoloDisegna(t, X(322)); // col bivio vicino la frase è già scritta grande
    }
    // piede: chilometro, quota e avanzamento
    double q[3];
    T.at(st.km, q);
    int yP = X(376);
    t.rettangolo(X(40), yP, W - X(80), X(6), false);
    t.rettangolo(X(40), yP, (int)((W - X(80)) * st.km / T.kmTot), X(6), true);
    t.zona(X(40), yP - 2, W - X(80), X(10), Colore::VERDE, Colore::NERO);
    snprintf(b, sizeof b, "km %s / %s", kmParlati(st.km).c_str(), kmParlati(T.kmTot).c_str());
    t.testo(X(40), yP + X(12), b, Dim::PICCOLO, Allinea::SINISTRA);
    snprintf(b, sizeof b, "quota %d m", (int)std::lround(q[2]));
    t.testo(W - X(40), yP + X(12), b, Dim::PICCOLO, Allinea::DESTRA);
}

void App::paginaErrore(Tela &t, const Stato &st)
{
    int W = t.larghezza();
    bool indietro = !st.fuori;
    const char *titolo = indietro ? "SENSO SBAGLIATO" : st.sbagliato ? "SENTIERO SBAGLIATO" : "FUORI PERCORSO";
    t.testo(W / 2, X(66), titolo, Dim::MEDIO, Allinea::CENTRO);
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
    double cx = W / 2, cy = X(190), a = rad(ang), c = std::cos(a), sn = std::sin(a), f = 0.85 * s;
    auto P = [&](double px, double py, int &ox, int &oy) {
        ox = (int)(cx + (px * c - py * sn) * f);
        oy = (int)(cy + (px * sn + py * c) * f);
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
        testoCentrato(t, "Girati", X(290), Dim::MEDIO, W);
    else {
        snprintf(b, sizeof b, "%d", metriParlati(d));
        numeroGrande(t, W / 2 - X(14), X(280), X(50), b, Allinea::CENTRO);
        t.testo(W / 2 + X(50) * 55 / 100 * (int)std::strlen(b) / 2 + X(4), X(302), "m", Dim::MEDIO, Allinea::SINISTRA);
    }
    t.zona(0, X(56), W, X(376), Colore::BIANCO, Colore::ROSSO_SCURO);
    t.zona(0, X(60), W, X(40), Colore::ROSSO, Colore::ROSSO_SCURO);
    if (!sottotitolo.empty() && oraMs <= sottotitoloFino)
        testoCentrato(t, sottotitolo.c_str(), X(344), Dim::PICCOLO, W - X(70));
}

// mappa con il nord in alto: rilievo, percorso, bivi, cime e la propria posizione. Un tocco cambia la scala.
void App::paginaMappa(Tela &t, const Stato &st, bool errore)
{
    static const double MPP[2] = {2, 5}; // metri per pixel alle prime due scale (su 410 pixel: 800 m e 2 km)
    static const int SCALA = 2;          // un colore di sfondo ogni 2 x 2 pixel
    int W = t.larghezza(), H = t.altezza();
    char b[64];
    const Prossimo &p = st.prossimo;
    bool vicino = !errore && st.agganciato && p.b && p.d <= 300 && !st.arrivato;
    int yTop = X(56), yTab = H - X(70), hStr = vicino ? X(92) : X(38), yBasso = yTab - hStr;
    int hM = yBasso - yTop, cx = W / 2, cy = yTop + hM / 2;
    int z = haFix ? zoom : 2; // senza posizione si vede il percorso intero
    double mpp, c[2];
    if (z == 2) {
        mpp = std::max(ampiezza[0] / (W - X(70)), ampiezza[1] / (hM - X(44)));
        c[0] = centro[0], c[1] = centro[1];
    } else {
        mpp = MPP[z] / s;
        c[0] = fix.lat, c[1] = fix.lon;
    }
    // il centro scatta sulla griglia dello sfondo: percorso e rilievo restano allineati
    double k = std::cos(rad(centro[0])), pLat = SCALA * mpp / 110540, pLon = SCALA * mpp / (k * 111320);
    c[0] = std::round(c[0] / pLat) * pLat;
    c[1] = std::round(c[1] / pLon) * pLon;
    auto xy = [&](double la, double lo, double &px, double &py) {
        px = cx + (lo - c[1]) * k * 111320 / mpp;
        py = cy - (la - c[0]) * 110540 / mpp;
    };
    auto inVista = [&](double px, double py, int m) { return px >= m && px <= W - m && py >= yTop + m && py <= yBasso - m; };
    if (terra) {
        rilievo.calcola(*terra, c[0], c[1], mpp, cx, cy, yTop, W, hM, SCALA, z == 0 ? 50 : z == 1 ? 100 : 200);
        t.sfondo(rilievo.buf.data(), rilievo.w, rilievo.h, SCALA, yTop, Rilievo::TAVOLOZZA, Rilievo::N_COLORI);
    }
    // percorso: sottile il tratto già fatto, spesso quello da fare
    double km = st.agganciato ? st.km : -1, px0 = 0, py0 = 0, px, py;
    double wFatto = 2 * s, wDaFare = (z == 2 ? 4 : 6) * s;
    for (int i = 0; i < T.n; i++) {
        xy(T.pts[i].lat, T.pts[i].lon, px, py);
        if (i > 0) {
            bool fuori = (px < -20 && px0 < -20) || (px > W + 20 && px0 > W + 20) || (py < yTop - 20 && py0 < yTop - 20) ||
                         (py > yBasso + 20 && py0 > yBasso + 20);
            if (!fuori)
                lineaSpessa(t, px0, py0, px, py, T.pts[i].km <= km ? wFatto : wDaFare);
        }
        px0 = px, py0 = py;
    }
    t.zona(0, yTop, W, hM, Colore::ARANCIO, Colore::NERO);
    // partenza e arrivo
    xy(T.pts[0].lat, T.pts[0].lon, px, py);
    if (inVista(px, py, 12)) {
        t.cerchio((int)px, (int)py, X(9), true);
        t.nero(true);
        t.cerchio((int)px, (int)py, X(5), true);
        t.nero(false);
        t.zona((int)px - X(10), (int)py - X(10), X(20), X(20), Colore::VERDE, Colore::NERO);
    }
    // bivi ancora da fare: ambra i prossimi, ad anello gli altri
    int colorati = 0;
    for (int i = 0; i < motore.nBivi; i++) {
        const Bivio &v = motore.bivi[i];
        if (v.silenzioso || v.km < km)
            continue;
        xy(v.lat, v.lon, px, py);
        if (!inVista(px, py, 4))
            continue;
        int r = z == 2 ? X(4) : X(7);
        t.cerchio((int)px, (int)py, r, true);
        if (v.km <= std::max(0.0, km) + 3 && colorati < 10) {
            t.zona((int)px - r - 1, (int)py - r - 1, 2 * r + 2, 2 * r + 2, Colore::AMBRA, Colore::NERO);
            colorati++;
        } else if (r > 4) {
            t.nero(true);
            t.cerchio((int)px, (int)py, r - 3, true);
            t.nero(false);
        }
    }
    // cime: le più alte fra quelle inquadrate, senza sovrapporre i nomi
    struct Etichetta {
        int x, y, w;
    } messe[5];
    int nMesse = 0, hT = t.altezzaTesto(Dim::PICCOLO);
    for (int i = 0; i < nVette && nMesse < (z == 2 ? 3 : 5); i++) {
        xy(vette[i].lat, vette[i].lon, px, py);
        if (!inVista(px, py, 30))
            continue;
        if (z == 2)
            snprintf(b, sizeof b, "%s", vette[i].nome);
        else
            snprintf(b, sizeof b, "%s %d", vette[i].nome, vette[i].quota);
        // il nome va sotto la cima, oppure sopra o di fianco: dove non copre il percorso né un altro nome
        int w = t.larghezzaTesto(b, Dim::PICCOLO), tx = 0, ty = -1;
        for (int prova = 0; prova < 4 && ty < 0; prova++) {
            int x = prova < 2 ? (int)px - w / 2 : prova == 2 ? (int)px + X(12) : (int)px - X(12) - w;
            int y = prova == 0 ? (int)py + X(8) : prova == 1 ? (int)py - X(10) - hT : (int)py - hT / 2;
            if (prova < 2)
                x = std::max(X(24), std::min(W - X(24) - w, x));
            bool libero = x >= X(20) && x + w <= W - X(20) && y >= yTop + X(4) && y + hT <= yBasso - X(4);
            for (int j = 0; j < nMesse && libero; j++)
                if (std::abs(y - messe[j].y) < hT + X(10) && x < messe[j].x + messe[j].w + 8 && messe[j].x < x + w + 8)
                    libero = false;
            for (int j = 0; j < T.n && libero; j++) {
                double qx, qy;
                xy(T.pts[j].lat, T.pts[j].lon, qx, qy);
                if (qx > x - 8 && qx < x + w + 8 && qy > y - 6 && qy < y + hT + 6)
                    libero = false;
            }
            if (libero)
                tx = x, ty = y;
        }
        if (ty < 0 && i == 0 && py - X(10) - hT >= yTop + X(4)) // il Velino si scrive comunque, sopra la cima
            tx = std::max(X(24), std::min(W - X(24) - w, (int)px - w / 2)), ty = (int)py - X(10) - hT;
        if (ty < 0)
            continue;
        messe[nMesse++] = {tx, ty, w};
        t.triangolo((int)px, (int)py - X(7), (int)px - X(7), (int)py + X(5), (int)px + X(7), (int)py + X(5));
        t.testo(tx, ty, b, Dim::PICCOLO, Allinea::SINISTRA);
        t.zona((int)px - X(8), (int)py - X(8), X(16), X(14), Colore::BIANCO, Colore::NERO);
        t.zona(tx - 2, ty, w + 4, hT + 2, Colore::BIANCO, Colore::NERO);
    }
    // la propria posizione, con il verso di marcia
    if (haFix) {
        xy(fix.lat, fix.lon, px, py);
        if (inVista(px, py, 0)) {
            if (motore.haDirezione()) {
                double a = rad(motore.direzione());
                punta(t, px + std::sin(a) * 22 * s, py - std::cos(a) * 22 * s, motore.direzione(), 0.5 * s);
            }
            t.cerchio((int)px, (int)py, X(13), true);
            t.nero(true);
            t.cerchio((int)px, (int)py, X(8), true);
            t.nero(false);
            t.cerchio((int)px, (int)py, X(5), true);
            t.zona((int)px - X(38), (int)py - X(38), X(76), X(76), Colore::BLU, Colore::NERO);
        }
    }
    // scala grafica e nord
    static const int METRI[] = {50, 100, 200, 500, 1000, 2000, 5000};
    int metri = METRI[0];
    for (int v : METRI)
        if (v / mpp <= X(110))
            metri = v;
    int lung = (int)(metri / mpp), xs = X(30), ys = yBasso - X(12);
    if (metri >= 1000)
        snprintf(b, sizeof b, "%d km", metri / 1000);
    else
        snprintf(b, sizeof b, "%d m", metri);
    t.nero(true);
    t.rettangolo(xs - X(6), ys - X(30), std::max(lung, t.larghezzaTesto(b, Dim::PICCOLO)) + X(12), X(40), true);
    t.nero(false);
    t.rettangolo(xs, ys, lung, X(4), true);
    t.rettangolo(xs, ys - X(5), 2, X(9), true);
    t.rettangolo(xs + lung - 2, ys - X(5), 2, X(9), true);
    t.testo(xs, ys - X(28), b, Dim::PICCOLO, Allinea::SINISTRA);
    t.zona(xs - X(6), ys - X(30), std::max(lung, t.larghezzaTesto(b, Dim::PICCOLO)) + X(12), X(40), Colore::BIANCO, Colore::NERO);
    int xn = W - X(40), yn = yTop + X(14);
    t.triangolo(xn, yn - X(8), xn - X(7), yn + X(6), xn + X(7), yn + X(6));
    t.testo(xn, yn + X(8), "N", Dim::PICCOLO, Allinea::CENTRO);
    t.zona(xn - X(10), yn - X(10), X(20), X(22) + hT, Colore::BIANCO, Colore::NERO);
    // suggerimento: sparisce da solo
    const char *nota = !haFix ? "Aspetto il GPS: percorso intero" : oraMs < suggerimentoFino ? "Tocca la mappa: cambia scala" : nullptr;
    if (nota) {
        int w = t.larghezzaTesto(nota, Dim::PICCOLO);
        t.nero(true);
        t.rettangolo(X(26), yTop + X(6), w + X(12), hT + X(6), true);
        t.nero(false);
        t.testo(X(32), yTop + X(8), nota, Dim::PICCOLO, Allinea::SINISTRA);
        t.zona(X(26), yTop + X(6), w + X(12), hT + X(6), haFix ? Colore::BIANCO : Colore::AMBRA, Colore::NERO);
    }
    // barra in alto e striscia in basso su fondo nero (coprono il percorso che esce dalla mappa)
    t.nero(true);
    t.rettangolo(0, 0, W, yTop, true);
    t.rettangolo(0, yBasso, W, hStr, true);
    t.nero(false);
    barra(t);
    int yS = yBasso + (hStr - hT) / 2;
    if (errore) {
        bool indietro = !st.fuori;
        if (indietro)
            snprintf(b, sizeof b, "SENSO SBAGLIATO: girati");
        else
            snprintf(b, sizeof b, "%s  %d m", st.sbagliato ? "SENTIERO SBAGLIATO" : "FUORI PERCORSO", metriParlati(st.dist));
        t.testo(W / 2, yS, b, Dim::PICCOLO, Allinea::CENTRO);
        t.zona(0, yBasso, W, hStr, Colore::BIANCO, Colore::ROSSO_SCURO);
    } else if (vicino) {
        freccia(t, p.b, X(72), yBasso + X(60), 0.3 * s);
        t.zona(X(24), yBasso, X(96), hStr, Colore::VERDE, Colore::NERO);
        if (p.d < 30)
            snprintf(b, sizeof b, "ORA");
        else
            snprintf(b, sizeof b, "%d m", metriParlati(p.d));
        t.testo(X(128), yBasso + X(8), b, Dim::MEDIO, Allinea::SINISTRA);
        t.zona(X(124), yBasso, W - X(124), X(44), Colore::AMBRA, Colore::NERO);
        t.testo(X(128), yBasso + X(52), p.b->titolo, Dim::PICCOLO, Allinea::SINISTRA);
    } else if (st.agganciato) {
        snprintf(b, sizeof b, "km %s", kmParlati(st.km).c_str());
        t.testo(X(34), yS, b, Dim::PICCOLO, Allinea::SINISTRA);
        if (!p.b)
            snprintf(b, sizeof b, "verso l'arrivo");
        else if (p.d >= 1000)
            snprintf(b, sizeof b, "bivio fra %s km", kmParlati(p.d / 1000).c_str());
        else
            snprintf(b, sizeof b, "bivio fra %d m", metriParlati(p.d));
        t.testo(W - X(34), yS, b, Dim::PICCOLO, Allinea::DESTRA);
    } else {
        if (haFix && distTraccia >= 950)
            snprintf(b, sizeof b, "Percorso di gara a %s km", kmParlati(distTraccia / 1000).c_str());
        else if (haFix && distTraccia >= 0)
            snprintf(b, sizeof b, "Percorso di gara a %d m", metriParlati(distTraccia));
        else
            snprintf(b, sizeof b, "Posizione: aspetto il GPS");
        t.testo(W / 2, yS, b, Dim::PICCOLO, Allinea::CENTRO);
        t.zona(0, yBasso, W, hStr, Colore::TENUE, Colore::NERO);
    }
}

void App::paginaGara(Tela &t, const Stato &st)
{
    int W = t.larghezza();
    char b[48];
    int trascorsi = oraLoc >= 0 ? oraLoc - partenzaSec : -1;
    if (trascorsi >= 0) {
        snprintf(b, sizeof b, "%d:%02d", trascorsi / 3600, trascorsi / 60 % 60);
        numeroGrande(t, W / 2, X(66), X(58), b, Allinea::CENTRO);
        t.testo(W / 2, X(130), "tempo di gara", Dim::PICCOLO, Allinea::CENTRO);
    } else if (oraLoc >= 0) {
        int m = (partenzaSec - oraLoc) / 60;
        snprintf(b, sizeof b, "Partenza fra %d h %02d min", m / 60, m % 60);
        testoCentrato(t, b, X(84), Dim::PICCOLO, W - X(70));
    } else
        testoCentrato(t, "Ora non ancora disponibile", X(84), Dim::PICCOLO, W - X(70));
    if (st.agganciato)
        snprintf(b, sizeof b, "km %s di %s", kmParlati(st.km).c_str(), kmParlati(T.kmTot).c_str());
    else
        snprintf(b, sizeof b, "percorso %s km", kmParlati(T.kmTot).c_str());
    t.testo(W / 2, X(158), b, Dim::MEDIO, Allinea::CENTRO);
    // profilo altimetrico con la posizione
    int x0 = X(40), x1 = W - X(40), y0 = X(262), y1 = X(200);
    double qmin = 700, qmax = 2500, q[3], px0 = 0, py0 = 0;
    for (double k = 0; k <= T.kmTot; k += 0.2) {
        T.at(k, q);
        double x = x0 + (x1 - x0) * k / T.kmTot, y = y0 + (y1 - y0) * (q[2] - qmin) / (qmax - qmin);
        if (k > 0)
            lineaSpessa(t, px0, py0, x, y, 2);
        px0 = x;
        py0 = y;
    }
    t.zona(x0 - 2, y1 - 4, x1 - x0 + 4, y0 - y1 + 8, Colore::TENUE, Colore::NERO);
    if (!st.agganciato) {
        testoCentrato(t, "Tempi e cancelli compaiono quando sei sul percorso.", X(290), Dim::PICCOLO, W - X(70));
        return;
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
        t.testo(W / 2, X(280), c.nome, Dim::MEDIO, Allinea::CENTRO);
        snprintf(b, sizeof b, "%s ore %d:%02d", c.km > 29 ? "tempo massimo" : "cancello", c.ora / 3600, c.ora / 60 % 60);
        t.testo(W / 2, X(314), b, Dim::PICCOLO, Allinea::CENTRO);
        if (trascorsi > 60 && st.km > 0.2) {
            double vel = st.km / trascorsi; // km al secondo
            int stima = oraLoc + (int)((c.km - st.km) / vel);
            int margine = (c.ora - stima) / 60;
            if (margine >= 0)
                snprintf(b, sizeof b, "margine %d min", margine);
            else
                snprintf(b, sizeof b, "in ritardo di %d min", -margine);
            t.testo(W / 2, X(346), b, Dim::MEDIO, Allinea::CENTRO);
            t.zona(0, X(344), W, X(34), margine >= 20 ? Colore::VERDE : margine >= 0 ? Colore::AMBRA : Colore::ROSSO, Colore::NERO);
        }
        break;
    }
}

void App::paginaSos(Tela &t)
{
    int W = t.larghezza(), m = W - X(70);
    char b[64];
    switch (sos) {
    case StatoSos::PRONTO:
        // il pulsante: tutto il cerchio rosso si tiene premuto
        t.cerchio(W / 2, X(196), X(104), true);
        t.nero(true);
        t.testo(W / 2, X(160), "SOS", Dim::MEDIO, Allinea::CENTRO);
        t.testo(W / 2, X(200), "TIENI PREMUTO", Dim::PICCOLO, Allinea::CENTRO);
        t.nero(false);
        t.zona(W / 2 - X(106), X(90), X(212), X(212), Colore::ROSSO, Colore::NERO);
        if (!sottotitolo.empty() && oraMs <= sottotitoloFino) {
            testoCentrato(t, sottotitolo.c_str(), X(330), Dim::MEDIO, m);
            t.zona(0, X(326), W, X(64), Colore::AMBRA, Colore::NERO);
        } else
            testoCentrato(t, "Tieni premuto il cerchio rosso, oppure un tasto laterale per 2 secondi", X(318), Dim::PICCOLO, m);
        break;
    case StatoSos::CONTO: {
        int r = (int)std::max<int64_t>(0, (fineConto - oraMs + 999) / 1000);
        t.cerchio(W / 2, X(196), X(104), true);
        snprintf(b, sizeof b, "%d", r);
        t.nero(true);
        numeroGrande(t, W / 2, X(150), X(80), b, Allinea::CENTRO);
        t.nero(false);
        t.zona(W / 2 - X(106), X(90), X(212), X(212), Colore::ROSSO, Colore::NERO);
        testoCentrato(t, "Sto per chiedere soccorso.", X(318), Dim::PICCOLO, m);
        testoCentrato(t, "Tocca per ANNULLARE", X(348), Dim::MEDIO, m);
        t.zona(0, X(344), W, X(40), Colore::AMBRA, Colore::NERO);
        break;
    }
    case StatoSos::INVIATO:
        t.testo(W / 2, X(70), "SOS INVIATO", Dim::MEDIO, Allinea::CENTRO);
        t.zona(0, X(66), W, X(36), Colore::ROSSO, Colore::NERO);
        snprintf(b, sizeof b, "Sto avvisando la base (invio %d)", tentativiSos);
        testoCentrato(t, b, X(124), Dim::PICCOLO, m);
        testoCentrato(t, "Resta dove sei. Copriti.", X(190), Dim::MEDIO, W - X(60));
        t.zona(0, X(186), W, X(70), Colore::AMBRA, Colore::NERO);
        testoCentrato(t, "Per ritirare l'SOS: un tasto laterale tenuto 2 secondi", X(330), Dim::PICCOLO, m);
        t.zona(0, X(326), W, X(60), Colore::TENUE, Colore::NERO);
        break;
    case StatoSos::CONFERMATO:
        t.testo(W / 2, X(70), "SOCCORSO AVVISATO", Dim::MEDIO, Allinea::CENTRO);
        t.zona(0, X(66), W, X(36), Colore::VERDE, Colore::NERO);
        snprintf(b, sizeof b, "La base ha ricevuto la tua posizione (in %d s).", (int)((tConfermaSos - tInvioSos) / 1000));
        testoCentrato(t, b, X(124), Dim::PICCOLO, m);
        testoCentrato(t, "Resta dove sei. Copriti.", X(190), Dim::MEDIO, W - X(60));
        t.zona(0, X(186), W, X(70), Colore::AMBRA, Colore::NERO);
        testoCentrato(t, "Per ritirare l'SOS: un tasto laterale tenuto 2 secondi", X(330), Dim::PICCOLO, m);
        t.zona(0, X(326), W, X(60), Colore::TENUE, Colore::NERO);
        break;
    }
}

} // namespace srm
