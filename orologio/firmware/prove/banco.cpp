// Banco di prova del motore C++: legge le posizioni di un caso e stampa gli avvisi (stesso formato di casi.mjs).
// g++ -std=c++17 -O2 -I../srm banco.cpp ../srm/srm_guida.cpp ../srm/srm_dati.cpp -o banco && ./banco casi/gara_intera.fix
#include "srm_dati.h"
#include "srm_guida.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "uso: banco caso.fix\n");
        return 2;
    }
    FILE *f = fopen(argv[1], "r");
    if (!f) {
        perror(argv[1]);
        return 2;
    }
    srm::Traccia t(srm::TRACCIA, srm::N_TRACCIA, srm::SENTIERI, srm::N_SENTIERI, srm::COMUNE, srm::N_COMUNE);
    srm::Opzioni o;
    o.rassicura = 600000;
    srm::Motore m(t, srm::BIVI, srm::N_BIVI, o);
    char riga[256];
    while (fgets(riga, sizeof riga, f)) {
        long long tms;
        char a[64], b[64];
        double acc = 0;
        int n = sscanf(riga, "%lld %63s %63s %lf", &tms, a, b, &acc);
        if (n < 2)
            continue;
        if (strcmp(a, "-") != 0) {
            srm::Fix x{strtod(a, nullptr), strtod(b, nullptr), acc, tms};
            for (auto &e : m.posizione(x))
                printf("%lld\t%s\t%s\n", tms, e.tipo.c_str(), e.testo.c_str());
        }
        for (auto &e : m.tick(tms))
            printf("%lld\t%s\t%s\n", tms, e.tipo.c_str(), e.testo.c_str());
    }
    fclose(f);
    return 0;
}
