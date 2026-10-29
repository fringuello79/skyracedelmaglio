// Frasi registrate dentro il firmware (generate da strumenti/voce_firmware.py)
#pragma once
#include <cstdint>
#include <cstring>

namespace srm
{
struct Clip {
    const char *nome;
    const uint8_t *dati; // file WAV completo (11025 Hz, 8 bit, mono)
    uint32_t len;
};
extern const Clip VOCE[];
extern const int N_VOCE;

inline const Clip *trovaClip(const char *nome)
{
    for (int i = 0; i < N_VOCE; i++)
        if (!std::strcmp(VOCE[i].nome, nome))
            return &VOCE[i];
    return nullptr;
}
} // namespace srm
