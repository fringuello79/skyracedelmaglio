// Prova dell'app dell'orologio sul PC: fa correre l'app sui casi di prova, salva le schermate (poi rese in PNG da
// schermi.py) e stampa i messaggi che l'orologio manderebbe alla base.
#include "srm_app.h"
#include "srm_dati.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

using namespace srm;

// superficie di disegno sul PC: forme rasterizzate qui, testi e zone colore registrati per schermi.py
class TelaPC : public Tela
{
  public:
    int W = 410, H = 502;
    std::vector<uint8_t> px = std::vector<uint8_t>(410 * 502, 0);
    bool inNero = false;
    std::string testi, zone;
    int larghezza() override { return W; }
    int altezza() override { return H; }
    void pulisci() override
    {
        std::fill(px.begin(), px.end(), 0);
        testi.clear();
        zone.clear();
    }
    void nero(bool n) override { inNero = n; }
    void punto(int x, int y)
    {
        if (x >= 0 && y >= 0 && x < W && y < H)
            px[y * W + x] = inNero ? 0 : 1;
    }
    void linea(int x0, int y0, int x1, int y1) override
    {
        int dx = std::abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -std::abs(y1 - y0), sy = y0 < y1 ? 1 : -1, e = dx + dy;
        for (;;) {
            punto(x0, y0);
            if (x0 == x1 && y0 == y1)
                break;
            int e2 = 2 * e;
            if (e2 >= dy) {
                e += dy;
                x0 += sx;
            }
            if (e2 <= dx) {
                e += dx;
                y0 += sy;
            }
        }
    }
    void rettangolo(int x, int y, int w, int h, bool pieno) override
    {
        for (int j = y; j < y + h; j++)
            for (int i = x; i < x + w; i++)
                if (pieno || j == y || j == y + h - 1 || i == x || i == x + w - 1)
                    punto(i, j);
    }
    void cerchio(int cx, int cy, int r, bool pieno) override
    {
        for (int j = -r; j <= r; j++)
            for (int i = -r; i <= r; i++) {
                int d = i * i + j * j;
                if (pieno ? d <= r * r : (d <= r * r && d >= (r - 1) * (r - 1)))
                    punto(cx + i, cy + j);
            }
    }
    void triangolo(int x0, int y0, int x1, int y1, int x2, int y2) override
    {
        int a = std::min({x0, x1, x2}), b = std::max({x0, x1, x2}), c = std::min({y0, y1, y2}), d = std::max({y0, y1, y2});
        auto lato = [](int ax, int ay, int bx, int by, int px, int py) { return (long)(bx - ax) * (py - ay) - (long)(by - ay) * (px - ax); };
        for (int y = c; y <= d; y++)
            for (int x = a; x <= b; x++) {
                long w0 = lato(x1, y1, x2, y2, x, y), w1 = lato(x2, y2, x0, y0, x, y), w2 = lato(x0, y0, x1, y1, x, y);
                if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))
                    punto(x, y);
            }
    }
    static int dimPx(Dim d) { return d == Dim::PICCOLO ? 19 : 28; }
    int larghezzaTesto(const char *s, Dim d) override
    {
        int n = 0;
        for (const char *c = s; *c; c++)
            if ((*c & 0xC0) != 0x80)
                n++;
        return n * (d == Dim::PICCOLO ? 9 : 14); // come ArialMT 16/24 in media
    }
    int altezzaTesto(Dim d) override { return dimPx(d); }
    void testo(int x, int y, const char *s, Dim d, Allinea a) override
    {
        std::string e;
        for (const char *c = s; *c; c++) {
            if (*c == '"' || *c == '\\')
                e += '\\';
            e += *c;
        }
        char b[64];
        snprintf(b, sizeof b, "%s{\"x\":%d,\"y\":%d,\"d\":%d,\"a\":%d,\"n\":%d,\"s\":\"", testi.empty() ? "" : ",", x, y, dimPx(d),
                 (int)a, inNero ? 1 : 0);
        testi += b + e + "\"}";
    }
    void zona(int x, int y, int w, int h, uint16_t on, uint16_t off) override
    {
        char b[128];
        snprintf(b, sizeof b, "%s[%d,%d,%d,%d,%u,%u]", zone.empty() ? "" : ",", x, y, w, h, on, off);
        zone += b;
    }
    void salva(const char *nome)
    {
        std::string p = std::string("schermi/") + nome + ".json";
        FILE *f = fopen(p.c_str(), "w");
        fprintf(f, "{\"w\":%d,\"h\":%d,\"testi\":[%s],\"zone\":[%s],\"px\":\"", W, H, testi.c_str(), zone.c_str());
        for (int i = 0; i < W * H; i += 4)
            fputc("0123456789abcdef"[px[i] << 3 | px[i + 1] << 2 | px[i + 2] << 1 | px[i + 3]], f);
        fprintf(f, "\"}\n");
        fclose(f);
    }
};

struct Riga {
    long long t;
    bool fix;
    Fix f;
};
static std::vector<Riga> leggi(const char *nome)
{
    std::vector<Riga> v;
    FILE *f = fopen(nome, "r");
    char r[256], a[64], b[64];
    long long t;
    double acc;
    while (f && fgets(r, sizeof r, f)) {
        int n = sscanf(r, "%lld %63s %63s %lf", &t, a, b, &acc);
        if (n < 2)
            continue;
        Riga x{t, strcmp(a, "-") != 0, {}};
        if (x.fix)
            x.f = {strtod(a, nullptr), strtod(b, nullptr), acc, t};
        v.push_back(x);
    }
    if (f)
        fclose(f);
    return v;
}

static Traccia traccia(TRACCIA, N_TRACCIA, SENTIERI, N_SENTIERI, COMUNE, N_COMUNE);
static TelaPC tela;

// fa correre l'app su un caso; a ogni secondo chiama «quando» che può premere tasti e salvare schermate
template <class F> static void corri(const char *caso, int pett, F quando)
{
    App app(traccia, BIVI, N_BIVI, pett);
    for (auto &r : leggi(caso)) {
        int oraLoc = 9 * 3600 + (int)(r.t / 1000);
        app.secondo(r.fix ? &r.f : nullptr, r.t, oraLoc, 87);
        Azioni a = app.prendiAzioni();
        for (auto &m : a.messaggi)
            printf("RADIO %lld %s\n", r.t, m.c_str());
        if (quando(app, r.t, a))
            break;
    }
}

int main()
{
    if (system("mkdir -p schermi") != 0)
        return 1;
    int nPre = 0, nInd = 0;
    bool fatti[10] = {};
    corri("casi/gara_intera.fix", 57, [&](App &app, long long t, Azioni &a) {
        for (auto &d : a.diario) {
            if (!fatti[0] && d.rfind("Fra ", 0) == 0 && ++nPre == 2) {
                app.disegna(tela, t), tela.salva("01_preavviso"), fatti[0] = true;
            }
            if (!fatti[1] && d.rfind("Bivio:", 0) == 0 && ++nInd == 4) {
                app.disegna(tela, t), tela.salva("02_indicazione"), fatti[1] = true;
            }
        }
        if (!fatti[2] && t > 2000000 && app.motore.stato().prossimo.d > 1100) {
            app.disegna(tela, t), tela.salva("03_dritto"), fatti[2] = true;
        }
        if (t == 3000000) {
            app.pagina = Pagina::MAPPA, app.disegna(tela, t), tela.salva("04_mappa");
            app.pagina = Pagina::GARA, app.disegna(tela, t), tela.salva("05_gara");
            app.pagina = Pagina::GUIDA;
            app.tasto(Tasto::CORONA, t);
            app.disegna(tela, t), tela.salva("06_visuale_800m");
            app.tasto(Tasto::TOCCO, t), app.disegna(tela, t), tela.salva("07_visuale_2km");
            app.tasto(Tasto::TOCCO, t), app.disegna(tela, t), tela.salva("08_visuale_tutto");
            app.tasto(Tasto::TOCCO, t), app.tasto(Tasto::CORONA, t);
        }
        if (t == 3300000)
            app.tasto(Tasto::CORONA, t); // modalità mappa per vedere il bivio vicino
        if (!fatti[3] && t > 3300000 && app.motore.stato().prossimo.d < 180) {
            app.disegna(tela, t), tela.salva("09_visuale_bivio"), fatti[3] = true;
            app.tasto(Tasto::CORONA, t);
        }
        // SOS: corona tenuta, conto alla rovescia, invio, conferma della base
        if (t == 5000000) {
            app.tasto(Tasto::CORONA_LUNGA, t), app.disegna(tela, t + 1500), tela.salva("10_sos_conto");
        }
        if (t == 5008000)
            app.disegna(tela, t), tela.salva("11_sos_inviato");
        if (t == 5021000) {
            char ok[40];
            snprintf(ok, sizeof ok, "SRM OK P%03d R%d", app.pettorale, app.rifSos);
            app.testoRicevuto(ok, t);
            app.disegna(tela, t), tela.salva("12_sos_confermato");
        }
        if (t == 5040000) {
            app.tasto(Tasto::CORONA_LUNGA, t); // l'atleta ritira l'SOS
            app.pagina = Pagina::GUIDA;
        }
        return t > 5100000;
    });
    corri("casi/sbaglia_S02-A.fix", 57, [&](App &app, long long t, Azioni &a) {
        for (auto &d : a.diario)
            if (d.rfind("Sentiero sbagliato", 0) == 0)
                app.disegna(tela, t), tela.salva("13_sentiero_sbagliato");
        return false;
    });
    corri("casi/fuori_15.8.fix", 57, [&](App &app, long long t, Azioni &a) {
        for (auto &d : a.diario)
            if (d.rfind("Fuori percorso", 0) == 0)
                app.disegna(tela, t), tela.salva("14_fuori_percorso");
        return false;
    });
    corri("casi/contrario.fix", 57, [&](App &app, long long t, Azioni &a) {
        for (auto &d : a.diario)
            if (d.rfind("Stai andando", 0) == 0)
                app.disegna(tela, t), tela.salva("15_senso_sbagliato");
        return false;
    });
    return 0;
}
