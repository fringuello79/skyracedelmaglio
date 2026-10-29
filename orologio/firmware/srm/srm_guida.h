// Guida SRM sul percorso: porting fedele di guida/motore.js e posizione/geo.js (stesse soglie, stesse frasi).
// Solo C++ standard: si compila sul PC per le prove e dentro il firmware Meshtastic.
#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <map>

namespace srm
{

struct Punto {
    double lat, lon, ele, km;
};

struct Sentiero {
    double da, a;
    const char *nome;
};

// Bivio già preparato (preparaBivio di motore.js, calcolato al banco e salvato in srm_dati.h)
struct Bivio {
    const char *id;
    const char *tipo;  // bivio, svolta, tornanti, sentiero
    double km, lat, lon;
    bool silenzioso;
    double verificaM;
    const char *titolo;
    const char *preResto; // «Fra N metri, » + questo; nullptr = niente preavviso
    const char *ind;
    const char *ora;      // nullptr = niente «Ora …»
    const char *giusto;   // "" = solo il tono
    int icona;            // gradi della freccia (0 = dritto, + destra)
    uint8_t altri;        // 1 = c'è un sentiero a sinistra, 2 = a destra
    uint8_t rami;
    int giro1, giro2;     // doppia svolta: angoli delle due svolte (0 = nessuna)
    const char *sentiero;
};

class Traccia
{
  public:
    Traccia(const Punto *p, int n, const Sentiero *s, int ns, const double (*comune)[2], int nc)
        : pts(p), n(n), sent(s), nsent(ns), com(comune), ncom(nc), kmTot(p[n - 1].km) {}
    const Punto *pts;
    int n;
    const Sentiero *sent;
    int nsent;
    const double (*com)[2];
    int ncom;
    double kmTot;

    void at(double km, double out[3]) const;
    double direzioneDopo(double km, double avanti = 0.06) const;
    const char *sentiero(double km) const;
    struct Proiezione {
        double d, km;
    };
    Proiezione proietta(double lat, double lon, double kmMin, double kmMax) const;
};

double distanza(double la1, double lo1, double la2, double lo2);
double rotta(double la1, double lo1, double la2, double lo2);
const char *cardinale(double b);
std::string kmParlati(double km);
int metriParlati(double m);

enum Priorita { SOS = 0, ERRORE = 1, BIVIO = 2, INFO = 3 };

struct Evento {
    std::string tipo; // aggancio, preavviso, indicazione, ora, giusto, fuori, sbagliato, rientro, indietro, conferma, gps, gps-ok,
                      // arrivo, attesa, lontano
    int priorita;
    std::string suono; // attenzione, allarme, positivo, ""
    std::string bivio; // id del bivio, se c'entra
    std::string testo;
};

struct Fix {
    double lat, lon, acc; // acc = precisione in metri
    int64_t t;            // ms
};

struct Opzioni {
    double precisioneMax = 50, corridoioMin = 25, corridoioMax = 60, corridoioBivio[2] = {20, 40};
    double preavviso = 200, indicazione = 40, adesso = 15, verifica = 60;
    int fuoriFix = 3;
    double fuoriMetri = 20;
    int sbagliatoFix = 2;
    double sbagliatoMetri = 10;
    int64_t ripetiFuori = 30000;
    double velMax = 30 / 3.6;
    int64_t gpsDebole = 60000;
    int indietroFix = 3;
    double indietroMetri = 25;
    int64_t attesaDirezione = 45000;
    int64_t rassicura = 300000;
};

struct Prossimo {
    const Bivio *b = nullptr;
    double d = 0;
};

struct Stato {
    bool agganciato;
    double km, dist;
    bool fuori, sbagliato, arrivato;
    double velocita;
    bool haDirezione;
    double direzione;
    Prossimo prossimo;
    const char *sentiero;
};

class Motore
{
  public:
    Motore(const Traccia &t, const Bivio *bivi, int nBivi, Opzioni o = Opzioni());
    void reset();
    std::vector<Evento> posizione(const Fix &f); // una posizione nuova
    std::vector<Evento> tick(int64_t t);         // ogni secondo circa, anche senza posizioni
    Stato stato() const;
    Prossimo prossimoBivio() const;
    std::string doveSono() const;
    void aggancia(double km, int64_t t);
    void silenziaIndietro(int64_t t, int64_t ms = 300000) { silenzioIndietroFino = t + ms; }

    // per lo schermo
    bool haDirezione() const { return dirOk; }
    double direzione() const { return dir; }
    const Bivio *bivi;
    int nBivi;

  private:
    struct Flag {
        bool pre = false, ind = false, ora = false, ver = false, sbagliato = false;
    };
    struct Fuori {
        int n;
        double primo[2];
        bool annunciato;
        int64_t ultimo;
        const Bivio *bivio;
    };
    const Traccia &T;
    Opzioni o;
    bool kmOk;
    double km;
    int64_t tKm;
    double kmMax;
    bool fuoriOk;
    Fuori fuori;
    std::vector<Fix> storia, buf;
    std::vector<Flag> flags;
    bool ultimaValidaOk;
    int64_t ultimaValida, ultimoMovimento;
    double velocita;
    bool dirOk;
    double dir;
    bool gpsAvvisato;
    struct {
        int n;
        bool daOk;
        double da[2];
        bool avvisato;
    } indietro;
    int64_t silenzioIndietroFino;
    bool arrivato;
    int64_t lontanoUltimo;
    bool posOk;
    Fix pos;
    bool distOk;
    double dist;
    bool attesaOk;
    int64_t attesa;
    bool attesaDetta;
    bool ultimoParlatoOk;
    int64_t ultimoParlato;

    std::vector<Evento> _posizione(Fix f);
    Flag &flag(const Bivio *b) { return flags[b - bivi]; }
    const Flag &flag(const Bivio *b) const { return flags[b - bivi]; }
    double corridoio(double acc) const;
    void movimento(const Fix &f);
    std::string lato(const Fix &f, const double q[3]) const;
    const Bivio *bivioRecente();
    void controllaVerso(std::vector<Evento> &ev, const Fix &f, const Traccia::Proiezione &p);
    void controllaBivi(std::vector<Evento> &ev, const Fix &f, bool primoAggancio, bool benCentrato = true);
};

} // namespace srm
