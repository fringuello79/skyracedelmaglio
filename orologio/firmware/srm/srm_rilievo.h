// Sfondo della mappa dell'orologio: rilievo ombreggiato e curve di livello calcolati dalle quote del terreno.
// Pochi dati (una quota ogni 50 m) e nessuna carta da caricare: l'immagine si calcola per la zona inquadrata.
#pragma once
#include <cstdint>
#include <vector>

namespace srm
{

struct Terreno {
    const int16_t *q; // quote in metri, riga 0 = sud
    int nx, ny;
    double lat0, lon0, dlat, dlon;
};
struct Vetta {
    const char *nome;
    int quota;
    double lat, lon;
};
extern const Terreno TERRENO;
extern const Vetta VETTE[];
extern const int N_VETTE;

class Rilievo
{
  public:
    static const int N_COLORI = 130;
    static const uint16_t TAVOLOZZA[N_COLORI]; // RGB565: 8 fasce di quota x 16 luci, poi curva e curva maestra
    std::vector<uint8_t> buf;                  // w x h indici nella tavolozza
    int w = 0, h = 0;

    // Calcola l'immagine per una mappa con il nord in alto. Il punto (lat, lon) cade nel pixel di schermo (cx, cy);
    // mpp = metri per pixel di schermo; l'immagine copre larg x alt pixel a partire da (0, y0), un indice ogni
    // 'scala' pixel. curve = distanza fra le curve di livello in metri. Se la vista è la stessa non ricalcola.
    void calcola(const Terreno &t, double lat, double lon, double mpp, int cx, int cy, int y0, int larg, int alt, int scala,
                 int curve);

  private:
    double kLat = 0, kLon = 0, kMpp = 0;
    int kCx = 0, kCy = 0, kY0 = 0, kLarg = 0, kAlt = 0, kScala = 0, kCurve = 0;
};

} // namespace srm
