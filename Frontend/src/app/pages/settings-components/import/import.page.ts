import { Component } from '@angular/core';
import { NavController } from '@ionic/angular';

import { RouteMap } from '@/services/util.service';

@Component({
  selector: 'page-import',
  templateUrl: 'import.page.html',
  styleUrls: ['import.page.scss']
})
export class ImportPage {

  constructor(
    public navCtrl: NavController) {
  }

  goToImportPepperplate() {
    this.navCtrl.navigateForward(RouteMap.ImportPepperplatePage.getPath());
  }

  goToImportLC() {
    this.navCtrl.navigateForward(RouteMap.ImportLivingcookbookPage.getPath());
  }

  goToImportPaprika() {
    this.navCtrl.navigateForward(RouteMap.ImportPaprikaPage.getPath());
  }
}
