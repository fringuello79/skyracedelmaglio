// App SRM dell'orologio: pagine, SOS, avvisi alla base. Porting di guida/orologio/orologio.js.
// Non conosce Meshtastic: riceve posizioni, tempo e tasti, restituisce azioni (vibra, suona, accendi, invia).
#pragma once
#include "srm_guida.h"
#include "srm_tela.h"
#include <string>
#include <vector>

namespace srm
{

enum class Tasto { TOCCO, SINISTRA, DESTRA, SU, GIU, CORONA, CORONA_LUNGA, PREMUTO_LUNGO };
enum class Vibra { NESSUNA, PREAVVISO, INDICAZIONE, ORA, ERRORE, TOCCO, SOS };
enum class Suono { NESSUNO, PREAVVISO, BIVIO, ERRORE, POSITIVO, SOS };
enum class Pagina { GUIDA, MAPPA, GARA, SOS };

struct Azioni {
    Vibra vibra = Vibra::NESSUNA;
    Suono suono = Suono::NESSUNO;
    bool sveglia = false;              // accendere lo schermo e mostrare la pagina SRM
    std::vector<std::string> messaggi; // testi SRM da mandare sulla rete
    std::vector<std::string> diario;   // frasi dette (per il registro e per la voce)
    std::string voce;                  // chiave della frase da riprodurre (voce registrata), vuota = nessuna
};

class App
{
  public:
    App(const Traccia &t, const Bivio *bivi, int nBivi, int pettorale, Opzioni o = Opzioni());

    // Un secondo: fix può essere nullptr (GPS senza posizione). oraLocale = secondi dalla mezzanotte, -1 se ignota.
    void secondo(const Fix *fix, int64_t ora, int32_t oraLocale = -1, int batteria = -1);
    bool tasto(Tasto t, int64_t ora);
    void testoRicevuto(const char *s, int64_t ora);
    Azioni prendiAzioni();
    bool tieniAcceso(int64_t ora) const { return visuale || ora < accesoFino; }
    void disegna(Tela &t, int64_t ora);

    Motore motore;
    Pagina pagina = Pagina::GUIDA;
    bool visuale = false;
    int zoom = 0;
    int pettorale;
    int partenzaSec = 9 * 3600; // ora di partenza della gara (ora locale)

    enum class StatoSos { PRONTO, CONTO, INVIATO, CONFERMATO };
    StatoSos sos = StatoSos::PRONTO;
    int rifSos = 0, tentativiSos = 0;
    int64_t fineConto = 0, prossimoSos = 0, tInvioSos = 0, tConfermaSos = 0;

  private:
    const Traccia &T;
    double centro[2]; // centro della traccia, per la mappa intera
    Azioni az;
    Fix fix{};
    bool haFix = false;
    int64_t tFix = -100000;
    int64_t oraMs = 0;
    int32_t oraLoc = -1;
    int batt = -1;
    int64_t accesoFino = 8000;
    bool statoInviato = false;
    std::string sottotitolo;
    int64_t sottotitoloFino = 0;
    std::string ultimoTipo;
    int64_t ultimoT = -1000000;

    void sveglia(int64_t ms);
    void evento(const Evento &e);
    void dalMotore(const std::vector<Evento> &ev);
    void invia(const char *tipo, bool conRif, bool conPos);

    // disegno
    double s = 1; // scala rispetto al progetto 410x502
    int X(double v) const { return (int)(v * s + 0.5); }
    void barra(Tela &t);
    void paginaGuida(Tela &t, const Stato &st);
    void paginaErrore(Tela &t, const Stato &st);
    void paginaMappa(Tela &t, const Stato &st);
    void paginaGara(Tela &t, const Stato &st);
    void paginaSos(Tela &t);
    void paginaVisuale(Tela &t, const Stato &st);
    void sottotitoloDisegna(Tela &t, int y);
    void freccia(Tela &t, const Bivio *b, int cx, int cy, double k);
    void numeroGrande(Tela &t, int x, int y, int h, const char *s, Allinea a);
    void testoCentrato(Tela &t, const char *s, int y, Dim d, int maxW);
};

void lineaSpessa(Tela &t, double x0, double y0, double x1, double y1, double w);
void punta(Tela &t, double x, double y, double ang, double k);

} // namespace srm
