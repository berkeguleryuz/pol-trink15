/**
 * AUTO-LINK MATCHES - Bot başlatılırken otomatik eşleştirme
 * 
 * NOT: match-live-games.ts'i çağırır (test edilmiş ve çalışıyor)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

/**
 * LIVE ve TODAY maçlarını API-Football'dan eşleştir
 */
export async function autoLinkMatches(dataPath: string): Promise<number> {
  try {
    // Manuel linking script'i çalıştır (test edilmiş, çalışıyor)
    const scriptPath = path.join(__dirname, 'match-live-games.ts');
    const { stdout } = await execAsync(`npx ts-node "${scriptPath}"`);
    
    // Eşleşen maç sayısını parse et
    const match = stdout.match(/(\d+) maç eşleştirildi/);
    return match ? parseInt(match[1]) : 0;
  } catch (error) {
    console.error('Auto-link hatası:', error);
    return 0;
  }
}
