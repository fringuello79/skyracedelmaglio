// Superficie di disegno astratta: sull'orologio la implementa OLEDDisplay di Meshtastic (SrmGuidaModule),
// sul PC un registratore che produce le immagini di prova. Monocromatica + zone colorate (come il TFT di Meshtastic).
#pragma once
#include <cstdint>

namespace srm
{

enum class Dim { PICCOLO, MEDIO, GRANDE }; // ~19, ~28, ~28 px (i numeri grandi li disegna l'app a segmenti)
enum class Allinea { SINISTRA, CENTRO, DESTRA };

constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b)
{
    return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}
namespace Colore
{
constexpr uint16_t NERO = 0x0000, BIANCO = 0xFFFF;
constexpr uint16_t VERDE = rgb(61, 220, 132), AMBRA = rgb(255, 176, 32), ROSSO = rgb(255, 77, 77), GRIGIO = rgb(125, 133, 128);
constexpr uint16_t TENUE = rgb(154, 163, 156), BLU = rgb(77, 163, 255), ARANCIO = rgb(255, 129, 2), ROSSO_SCURO = rgb(90, 13, 13);
} // namespace Colore

class Tela
{
  public:
    virtual ~Tela() {}
    virtual int larghezza() = 0;
    virtual int altezza() = 0;
    virtual void pulisci() = 0;
    virtual void nero(bool n) = 0; // true = disegna in nero (cancella), false = in bianco (acceso)
    virtual void linea(int x0, int y0, int x1, int y1) = 0;
    virtual void rettangolo(int x, int y, int w, int h, bool pieno) = 0;
    virtual void cerchio(int x, int y, int r, bool pieno) = 0;
    virtual void triangolo(int x0, int y0, int x1, int y1, int x2, int y2) = 0; // pieno
    virtual void testo(int x, int y, const char *s, Dim d, Allinea a) = 0;      // y = bordo alto del testo
    virtual int larghezzaTesto(const char *s, Dim d) = 0;
    virtual int altezzaTesto(Dim d) = 0;
    // zona colorata: i pixel accesi dentro il rettangolo prendono 'acceso', quelli spenti 'spento' (RGB565)
    virtual void zona(int x, int y, int w, int h, uint16_t acceso, uint16_t spento) = 0;
};

} // namespace srm
