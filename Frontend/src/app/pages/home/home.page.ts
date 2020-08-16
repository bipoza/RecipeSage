import { Component, ViewChild, AfterViewInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController, AlertController, ToastController, PopoverController } from '@ionic/angular';
import { Datasource, IDatasource } from 'ngx-ui-scroll';

import { RecipeService, Recipe } from '@/services/recipe.service';
import { MessagingService } from '@/services/messaging.service';
import { UserService } from '@/services/user.service';
import { LoadingService } from '@/services/loading.service';
import { WebsocketService } from '@/services/websocket.service';
import { EventService } from '@/services/event.service';
import { UtilService, RouteMap, AuthType } from '@/services/util.service';

import { LabelService, Label } from '@/services/label.service';
import { PreferencesService, MyRecipesPreferenceKey } from '@/services/preferences.service';
import { HomePopoverPage } from '@/pages/home-popover/home-popover.page';

const RECIPE_TILE_SIZE_PX = 220;

@Component({
  selector: 'page-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss']
})
export class HomePage {
  loading = true;

  labels: Label[] = [];
  selectedLabels: string[] = [];

  recipes: Recipe[] = [];
  knownRecipesById: { [key: string]: Recipe } = {};
  totalRecipeCount = -1;

  selectedRecipeIds: string[] = [];
  selectionMode = false;

  searchText = '';
  searchResults: Recipe[] = [];

  folder: string;
  folderTitle: string;

  preferences = this.preferencesService.preferences;
  preferenceKeys = MyRecipesPreferenceKey;
  viewType = this.preferences[this.preferenceKeys.ViewType];

  reloadPending = false;

  datasource: IDatasource = new Datasource({
    get: (idx, count) => this.dataSourceGet(idx, count),
    settings: {
      startIndex: 0,
      padding: 3, // # of viewports worth of extra items to keep
      // bufferSize: 25, // Minimum # to fetch in a single pagination request
    }
  });

  rowRatio = 1;

  constructor(
    public navCtrl: NavController,
    public route: ActivatedRoute,
    public events: EventService,
    public popoverCtrl: PopoverController,
    public loadingService: LoadingService,
    public alertCtrl: AlertController,
    public toastCtrl: ToastController,
    public recipeService: RecipeService,
    public labelService: LabelService,
    public userService: UserService,
    public utilService: UtilService,
    public preferencesService: PreferencesService,
    public websocketService: WebsocketService,
    public messagingService: MessagingService) {

    this.folder = this.route.snapshot.paramMap.get('folder') || 'main';
    switch (this.folder) {
      case 'inbox':
        this.folderTitle = 'Recipe Inbox';
        break;
      default:
        this.folderTitle = 'My Recipes';
        break;
    }

    this.updateRowRatio();

    this.resetAndLoadLabels();

    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.updateRowRatio();
      }, 200);
    });

    events.subscribe('recipe:created', () => this.reloadPending = true);
    events.subscribe('recipe:modified', () => this.reloadPending = true);
    events.subscribe('recipe:deleted', () => this.reloadPending = true);
    events.subscribe('label:created', () => this.reloadPending = true);
    events.subscribe('label:deleted', () => this.reloadPending = true);
    events.subscribe('import:pepperplate:complete', () => {
      const loading = this.loadingService.start();
      this.resetAndLoadAll().then(() => {
        loading.dismiss();
      }, () => {
        loading.dismiss();
      });
    });

    this.websocketService.register('messages:new', payload => {
      if (payload.recipe && this.folder === 'inbox') {
        this.resetAndLoadRecipes();
      }
    }, this);
  }

  ionViewWillEnter() {
    this.clearSelectedRecipes();

    if (this.reloadPending) {
      const loading = this.loadingService.start();
      this.resetAndLoadAll().then(() => {
        loading.dismiss();
      }, () => {
        loading.dismiss();
      });
    }
  }

  refresh(refresher) {
    this.resetAndLoadAll().then(() => {
      refresher.target.complete();
    }, () => {
      refresher.target.complete();
    });
  }

  resetAndLoadAll(): Promise<any> {
    this.reloadPending = false;

    if (this.selectedLabels.length === 0) {
      return Promise.all([
        this.resetAndLoadLabels(),
        this.resetAndLoadRecipes()
      ]);
    }

    return this.resetAndLoadLabels().then(() => {
      const labelNames = this.labels.map(e => e.title);

      this.selectedLabels.splice(0, this.selectedLabels.length, ...this.selectedLabels.filter(e => labelNames.indexOf(e) > -1));

      return this.resetAndLoadRecipes();
    });
  }

  resetAndLoadRecipes() {
    this.recipes = [];
    this.knownRecipesById = {};
    this.datasource.adapter.reload();
  }

  resetAndLoadLabels() {
    this.labels = [];
    return this.loadLabels();
  }

  async dataSourceGet(offset, numToFetch) {
    if (this.preferences[this.preferenceKeys.ViewType] === 'list') {
      return this.loadRecipes(offset, numToFetch);
    }

    if (this.preferences[this.preferenceKeys.ViewType] === 'tiles') {
      const rowRatio = this.rowRatio;
      const recipes = await this.loadRecipes(offset * rowRatio, numToFetch * rowRatio);

      return (recipes || []).reduce((acc, recipe, idx) => {
        const groupIdx = Math.floor(idx / rowRatio);

        acc[groupIdx] = acc[groupIdx] || [];
        acc[groupIdx].push(recipe);
        return acc;
      }, []);
    }
  }

  async loadRecipes(offset, numToFetch) {
    if (offset < 0) return console.log('requested invalid offset: ', offset);

    if (this.searchText && this.searchText.trim().length > 0) {
      const items = this.searchResults.slice(offset, offset + numToFetch);
      return items;
    }

    const stepSize = 50;
    const startOffset = Math.floor(this.recipes.length / stepSize) * stepSize;

    for (let currOffset = startOffset; currOffset < offset + numToFetch; currOffset += stepSize) {
      const alreadyHaveRequested = currOffset + stepSize < this.recipes.length;
      const alreadyHaveAll = this.totalRecipeCount === this.recipes.length;
      const greaterThanTotalCount = this.totalRecipeCount !== -1 && offset > this.totalRecipeCount;

      if (!alreadyHaveRequested && !greaterThanTotalCount && !alreadyHaveAll) {
        await this._loadRecipes(currOffset, stepSize);
      }
    }

    return this.recipes.slice(offset, offset + numToFetch);
  }

  async _loadRecipes(offset, numToFetch) {
    this.loading = true;
    return this.recipeService.fetch({
      folder: this.folder,
      sortBy: this.preferences[MyRecipesPreferenceKey.SortBy],
      offset,
      count: numToFetch,
      labelIntersection: this.preferences[MyRecipesPreferenceKey.EnableLabelIntersection],
      ...(this.selectedLabels.length > 0 ? { labels: this.selectedLabels } : {})
    }).then(response => {

      this.totalRecipeCount = response.totalCount;

      response.data.forEach(recipe => this.knownRecipesById[recipe.id] = recipe);

      this.recipes.splice(offset, response.data.length, ...response.data);

      this.loading = false;

      return response.data;

    }).catch(async err => {
      switch (err.response.status) {
        case 0:
          const offlineToast = await this.toastCtrl.create({
            message: this.utilService.standardMessages.offlineFetchMessage,
            duration: 5000
          });
          offlineToast.present();
          break;
        case 401:
          this.navCtrl.navigateRoot(RouteMap.AuthPage.getPath(AuthType.Login));
          break;
        default:
          const errorToast = await this.toastCtrl.create({
            message: this.utilService.standardMessages.unexpectedError,
            duration: 30000
          });
          errorToast.present();
          break;
      }
    });
  }

  async loadLabels() {
    this.labels = await this.labelService.fetch();
  }

  toggleLabel(labelTitle) {
    const labelIdx = this.selectedLabels.indexOf(labelTitle);
    labelIdx > -1 ?
      this.selectedLabels.splice(labelIdx, 1) : this.selectedLabels.push(labelTitle);
    this.resetAndLoadRecipes();
  }

  openRecipe(recipe, event?) {
    if (event && (event.metaKey || event.ctrlKey)) {
      window.open(`#/recipe/${recipe.id}`);
      return;
    }
    this.navCtrl.navigateForward(RouteMap.RecipePage.getPath(recipe.id));
  }

  async presentPopover(event) {
    const popover = await this.popoverCtrl.create({
      component: HomePopoverPage,
      componentProps: {
        labels: this.labels,
        selectedLabels: this.selectedLabels,
        selectionMode: this.selectionMode
      },
      event
    });

    popover.onDidDismiss().then(({ data }) => {
      if (data) {
        if (data.refreshSearch) this.resetAndLoadRecipes();
        if (typeof data.selectionMode === 'boolean') {
          this.selectionMode = data.selectionMode;
          if (!this.selectionMode) {
            this.clearSelectedRecipes();
          }
        }
      }

      this.updateViewType();
    });

    popover.present();
  }

  updateViewType() {
    const previousViewType = this.viewType;

    this.viewType = this.preferences[this.preferenceKeys.ViewType];
    if (this.viewType !== previousViewType) this.datasource.adapter.reload();
  }

  newRecipe() {
    this.navCtrl.navigateForward(RouteMap.EditRecipePage.getPath('new'));
  }

  search(text) {
    if (text.trim().length === 0) {
      this.searchText = '';
      this.resetAndLoadRecipes();
      return;
    }

    const loading = this.loadingService.start();
    this.loading = true;

    this.searchText = text;

    return this.recipeService.search(text, {
      ...(this.selectedLabels.length > 0 ? { labels: this.selectedLabels } : {})
    }).then(response => {
      loading.dismiss();

      this.searchResults = response.data;
      this.datasource.adapter.reload();
      this.loading = false;
    }).catch(async err => {
      loading.dismiss();

      switch (err.response.status) {
        case 0:
          const offlineToast = await this.toastCtrl.create({
            message: this.utilService.standardMessages.offlineFetchMessage,
            duration: 5000
          });
          offlineToast.present();
          break;
        case 401:
          this.navCtrl.navigateRoot(RouteMap.AuthPage.getPath(AuthType.Login));
          break;
        default:
          const errorToast = await this.toastCtrl.create({
            message: this.utilService.standardMessages.unexpectedError,
            duration: 30000
          });
          errorToast.present();
          break;
      }
    });
  }

  trackByFn(index, item) {
    return item.id;
  }

  selectRecipe(recipe) {
    const index = this.selectedRecipeIds.indexOf(recipe.id);
    if (index > -1) {
      this.selectedRecipeIds.splice(index, 1);
    } else {
      this.selectedRecipeIds.push(recipe.id);
    }
  }

  clearSelectedRecipes() {
    this.selectionMode = false;
    this.selectedRecipeIds = [];
  }

  async addLabelToSelectedRecipes() {
    const prompt = await this.alertCtrl.create({
      header: 'Add Label to Selected Recipes',
      message: 'Enter the name for the label',
      inputs: [
        {
          name: 'labelName',
          placeholder: 'Label Name'
        },
      ],
      buttons: [
        {
          text: 'Cancel'
        },
        {
          text: 'Save',
          handler: ({ labelName }) => {
            const loading = this.loadingService.start();
            this.labelService.createBulk({
              recipeIds: this.selectedRecipeIds,
              title: labelName.toLowerCase()
            }).then(() => {
              this.resetAndLoadAll().then(() => {
                loading.dismiss();
              }, () => {
                loading.dismiss();
              });
            }).catch(async err => {
              switch (err.response.status) {
                case 0:
                  const offlineToast = await this.toastCtrl.create({
                    message: this.utilService.standardMessages.offlinePushMessage,
                    duration: 5000
                  });
                  offlineToast.present();
                  break;
                default:
                  const errorToast = await this.toastCtrl.create({
                    message: this.utilService.standardMessages.unexpectedError,
                    duration: 30000
                  });
                  errorToast.present();
                  break;
              }
            });
          }
        }
      ]
    });
    prompt.present();
  }

  async deleteSelectedRecipes() {
    const recipeNames = this.selectedRecipeIds.map(recipeId => this.knownRecipesById[recipeId]?.title)
                                              .filter(name => name)
                                              .join('<br />');

    const alert = await this.alertCtrl.create({
      header: 'Confirm Delete',
      message: `This will permanently delete the selected recipes from your account. This action is irreversible.<br /><br />
                The following recipes will be deleted:<br />${recipeNames}`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          handler: () => { }
        },
        {
          text: 'Delete',
          cssClass: 'alertDanger',
          handler: () => {
            const loading = this.loadingService.start();
            this.recipeService.removeBulk(this.selectedRecipeIds).then(() => {
              this.clearSelectedRecipes();

              this.resetAndLoadAll().then(() => {
                loading.dismiss();
              }, () => {
                loading.dismiss();
              });
            }).catch(async err => {
              switch (err.response.status) {
                case 0:
                  const offlineToast = await this.toastCtrl.create({
                    message: this.utilService.standardMessages.offlinePushMessage,
                    duration: 5000
                  });
                  offlineToast.present();
                  break;
                default:
                  const errorToast = await this.toastCtrl.create({
                    message: this.utilService.standardMessages.unexpectedError,
                    duration: 30000
                  });
                  errorToast.present();
                  break;
              }
            });
          }
        }
      ]
    });
    alert.present();
  }

  updateRowRatio() {
    const previousRowRatio = this.rowRatio;
    const ASSUMED_SCROLLBAR_WIDTH_PX = 20;
    const availableWidth = window.innerWidth - ASSUMED_SCROLLBAR_WIDTH_PX;
    this.rowRatio = Math.floor(availableWidth / RECIPE_TILE_SIZE_PX);
    const isTileMode = this.preferences[this.preferenceKeys.ViewType] === 'tiles'
    if (isTileMode && this.rowRatio !== previousRowRatio) this.datasource.adapter.reload();
  }

  shouldDisplayWelcome() {
    return !this.loading
      && this.folder === 'main'
      && this.totalRecipeCount === 0
      && this.searchText.length === 0
      && this.selectedLabels.length === 0
  }

  shouldDisplayInboxEmpty() {
    return !this.loading && this.folder === 'inbox' && this.totalRecipeCount === 0 && this.searchText.length === 0
  }

  shouldDisplayNoResults() {
    return !this.loading && !this.searchResults?.length && this.searchText.length > 0
  }
}
